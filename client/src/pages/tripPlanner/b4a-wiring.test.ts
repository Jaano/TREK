import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ts from 'typescript'
import { test, vi } from 'vitest'

vi.mock('../../../../server/src/config', () => { throw new Error('Config initialization is forbidden in static tests') })
vi.mock('../../../../server/src/db/database', () => { throw new Error('Legacy database imports are forbidden in static tests') })
vi.mock('../../../../server/src/nest/database/database.service', () => { throw new Error('Database service imports are forbidden in static tests') })
vi.mock('better-sqlite3', () => { throw new Error('SQLite imports are forbidden in static tests') })

const pagePath = 'client/src/pages/TripPlannerPage.tsx'
const hookPath = 'client/src/pages/tripPlanner/useTripPlanner.ts'
const pageText = readFileSync(resolve(process.cwd(), 'src/pages/TripPlannerPage.tsx'), 'utf8')
const hookText = readFileSync(resolve(process.cwd(), 'src/pages/tripPlanner/useTripPlanner.ts'), 'utf8')
const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
const page = parse(pagePath, pageText)
const hook = parse(hookPath, hookText)

function collect(source: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const matches: ts.Node[] = []
  function visit(node: ts.Node) {
    if (predicate(node)) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return matches
}

function initializer(name: string): ts.Expression {
  const declaration = collect(hook, node => ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name) && node.name.text === name)[0]
  assert.ok(declaration && ts.isVariableDeclaration(declaration) && declaration.initializer, name)
  return declaration.initializer
}

function jsxTags(source: ts.SourceFile, name: string) {
  return collect(source, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && node.tagName.getText(source) === name)
}

test('B4A Core testability debt: verify source without importing the page, hook, config, or database', () => {
  for (const source of [page, hook]) {
    const diagnostics = ts.transpileModule(source.text, {
      fileName: source.fileName,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
    }).diagnostics ?? []
    assert.equal(diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).length, 0, source.fileName)
    assert.doesNotMatch(source.text, /^(<<<<<<<|=======|>>>>>>>)/m)
  }
  assert.doesNotMatch(pageText, /\bnarrowPanels\b/)
  const self = parse('b4a-wiring.test.ts', readFileSync(resolve(process.cwd(), 'src/pages/tripPlanner/b4a-wiring.test.ts'), 'utf8'))
  const imports = collect(self, ts.isImportDeclaration).map(node => {
    assert.ok(ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
    return node.moduleSpecifier.text
  })
  assert.deepEqual(imports, ['node:assert/strict', 'node:fs', 'node:path', 'typescript', 'vitest'])
  assert.equal(collect(self, node => ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword).length, 0)
})

test('B4A Tours tab is readable, desktop-only, and absent with addon OFF', () => {
  const tabs = initializer('TRIP_TABS')
  const branches = collect(tabs, node => ts.isConditionalExpression(node)
    && node.whenTrue.getText(hook).includes("id: 'tour-planner'"))
  assert.equal(branches.length, 1)
  const branch = branches[0]
  assert.ok(ts.isConditionalExpression(branch))
  assert.equal(branch.condition.getText(hook), 'enabledAddons.tours && !isMobile')
  assert.equal(branch.whenFalse.getText(hook), '[]')
  assert.match(branch.whenTrue.getText(hook), /desktopOnly: true/)
  assert.doesNotMatch(tabs.getText(hook), /\bcan\b|canPlaceEdit|canDayEdit/)
  assert.match(hookText, /!validTabIds\.includes\(activeTab\)[\s\S]*?setActiveTab\('plan'\)/)
  assert.match(pageText, /activeTab === 'tour-planner' && enabledAddons\.tours && !isMobile/)
})

test('B4A selectedTour is derived only from explicit place selection and addon state', () => {
  const selection = initializer('selectedTour')
  assert.ok(ts.isConditionalExpression(selection))
  assert.equal(selection.condition.getText(hook), 'toursEnabled && selectedPlaceId')
  assert.match(selection.whenTrue.getText(hook), /^tours\.find\(\w+ => \w+\.place_id === selectedPlaceId\) \?\? null$/)
  assert.equal(selection.whenFalse.kind, ts.SyntaxKind.NullKeyword)
})

test('B4A approved permissions reach every Tours surface and gate map edits', () => {
  assert.match(pageText, /const canPlaceEdit = can\('place_edit', trip\)/)
  assert.match(pageText, /const canDayEdit = can\('day_edit', trip\)/)
  assert.match(pageText, /useTourPlanner\(\{\s*tripId,\s*canEdit: canPlaceEdit,\s*canAssign: canDayEdit,/)
  for (const name of ['TourPlannerRail', 'TourPlannerToursRail', 'ToursSidebar', 'TourDetailDialog']) {
    const tags = jsxTags(page, name)
    assert.equal(tags.length, name === 'TourDetailDialog' ? 2 : 1)
    for (const tag of tags) {
      assert.match(tag.getText(page), /canEdit=\{canPlaceEdit\}/)
      assert.match(tag.getText(page), /canAssign=\{canDayEdit\}/)
    }
  }
  assert.match(pageText, /onMapClick=\{canPlaceEdit && !tourPlanner\.isSaving && \(tourPlanner\.mode\.type === 'new-draft' \|\| tourPlanner\.mode\.type === 'edit-saved'\)/)
})

test('B4A dedicated desktop controller retains GPX, draft, focus, and saved rail wiring', () => {
  const entry = collect(page, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'TripPlannerPageDesktop')[0]
  assert.ok(entry)
  assert.equal(collect(entry, node => ts.isCallExpression(node)
    && node.expression.getText(page) === 'useTourPlanner').length, 1)
  assert.doesNotMatch(hookText, /\buseTourPlanner\b/)
  for (const mode of ['view-gpx', 'new-draft', 'edit-saved']) assert.ok(pageText.includes(`tourPlanner.mode.type === '${mode}'`))
  assert.match(pageText, /readOnlyGpxAnalysis\?\.routeCoordinates/)
  assert.match(pageText, /routeProfileFocus=\{tourPlanner\.routeProfileFocus\}/)
  assert.match(pageText, /tourPlanner\.viewGpxTour\(tour, place\?\.route_geometry \?\? null\)/)
  assert.match(pageText, /onSaved:[\s\S]*?upsertTour\(result\.tour\)/)
  assert.doesNotMatch(pageText, /setSelectedPlaceId\(result\.tour/)
})

test('B4A retains non-Tours panels and protected page integrations', () => {
  for (const name of ['HelpAnchor', 'RoadtripSidebar', 'RoadtripCorridorPanel', 'DayDetailPanel', 'PlaceInspector', 'BookingDetailPopup']) {
    assert.ok(jsxTags(page, name).length > 0, name)
  }
  assert.ok(jsxTags(page, 'PanelResizeHandle').length >= 2)
  for (const tab of ['transports', 'buchungen', 'listen', 'finanzplan', 'dateien', 'collab']) {
    const panels = collect(page, node => ts.isJsxExpression(node)
      && !!node.expression && ts.isBinaryExpression(node.expression)
      && node.expression.left.getText(page) === `activeTab === '${tab}'`)
    assert.equal(panels.length, 1, tab)
  }
  assert.match(hookText, /dayDetail && days\.some\(d => d\.id === dayDetail\.id\) \? dayDetail : null/)
  assert.match(hookText, /!stop\.automaticNight && !stop\.bookend/)
})