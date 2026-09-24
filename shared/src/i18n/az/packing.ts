import type { TranslationStrings } from '../types';

const packing: TranslationStrings = {
  'packing.actions': 'Əməliyyatlar',
  'packing.editDone': 'Hazır',
  'packing.personalEmptyHint':
    'Şəxsi siyahınız boşdur — paylaşılan elementləri siyahınıza köçürün və ya yenisini əlavə edin.',
  'packing.assignMembers': 'Üzvləri təyin et',
  'packing.categoryOptions': 'Siyahı seçimləri',
  'packing.editItem': 'Elementi redaktə et',
  'packing.itemName': 'Ad',
  'packing.itemQuantity': 'Say',
  'packing.itemWeight': 'Çəki (qram)',

  'packing.title': 'Baqaj siyahısı',
  'packing.empty': 'Baqaj siyahısı boşdur',
  'packing.import': 'İdxal et',
  'packing.importTitle': 'Baqaj siyahısını idxal et',
  'packing.importHint':
    'Hər sətirdə bir element. Format: Kateqoriya, Ad, qramla çəki (istəyə bağlı), Çanta (istəyə bağlı), checked/unchecked (istəyə bağlı)',
  'packing.importPlaceholder':
    'Gigiyena, Diş fırçası\nGeyim, Köynəklər, 200\nSənədlər, Pasport, , Əl yükü\nElektronika, Şarj cihazı, 50, Çamadan, checked',
  'packing.importCsv': 'CSV/TXT yüklə',
  'packing.importAction': '{count} elementi idxal et',
  'packing.importSuccess': '{count} element idxal edildi',
  'packing.importError': 'İdxal uğursuz oldu',
  'packing.importEmpty': 'İdxal ediləcək element yoxdur',

  'packing.progress':
    '{total} elementdən {packed} yığılıb ({percent}%)',
  'packing.clearChecked': 'İşarələnmiş {count} elementi sil',
  'packing.clearCheckedShort': '{count} elementi sil',

  'packing.suggestions': 'Təkliflər',
  'packing.suggestionsTitle': 'Təklifləri əlavə et',
  'packing.allSuggested': 'Bütün təkliflər əlavə edilib',
  'packing.allPacked': 'Hər şey yığılıb!',

  'packing.addPlaceholder': 'Yeni element əlavə et...',
  'packing.categoryPlaceholder': 'Siyahı...',
  'packing.filterAll': 'Hamısı',
  'packing.filterOpen': 'Hazır deyil',
  'packing.filterDone': 'Hazırdır',

  'packing.emptyTitle': 'Baqaj siyahısı boşdur',
  'packing.emptyHint':
    'Elementlər əlavə edin və ya təkliflərdən istifadə edin',
  'packing.emptyFiltered':
    'Bu filtrə uyğun heç bir element yoxdur',

  'packing.menuRename': 'Adını dəyiş',
  'packing.menuCheckAll': 'Hamısını işarələ',
  'packing.menuUncheckAll': 'Bütün işarələri sil',
  'packing.menuDeleteCat': 'Siyahını sil',

  'packing.noMembers': 'Səyahət üzvü yoxdur',
  'packing.addItem': 'Element əlavə et',
  'packing.addItemPlaceholder': 'Elementin adı...',
  'packing.addCategory': 'Siyahı əlavə et',
  'packing.newCategoryPlaceholder':
    'Siyahının adı (məs. Geyim)',

  'packing.applyTemplate': 'Şablonu tətbiq et',
  'packing.template': 'Şablon',
  'packing.templateApplied':
    'Şablondan {count} element əlavə edildi',
  'packing.templateError': 'Şablonu tətbiq etmək mümkün olmadı',
  'packing.saveAsTemplate': 'Şablon kimi yadda saxla',
  'packing.templateName': 'Şablonun adı',
  'packing.templateSaved':
    'Baqaj siyahısı şablon kimi yadda saxlanıldı',

  'packing.bags': 'Çantalar',
  'packing.noBag': 'Təyin edilməyib',
  'packing.totalWeight': 'Ümumi çəki',
  'packing.quantity': 'Say',
  'packing.bagName': 'Çantanın adı...',
  'packing.addBag': 'Çanta əlavə et',
  'packing.changeCategory': 'Siyahıya köçür',

  'packing.makePrivate': 'Şəxsi et',
  'packing.makePublic': 'Paylaşılan et',
  'packing.privateHint': 'Şəxsi — yalnız sizə görünür',
  'packing.viewCommon': 'Paylaşılan',
  'packing.viewPersonal': 'Mənim siyahım',
  'packing.share': 'Paylaşım',
  'packing.tierCommonHint':
    'Ümumi siyahıdadır və hər kəsə görünür',
  'packing.tierPersonal': 'Şəxsi',
  'packing.tierPersonalHint': 'Şəxsi — yalnız siz görə bilərsiniz',
  'packing.tierShared': 'Paylaşılıb:',
  'packing.noOneToShare':
    'Bu səyahətdə hələ başqa üzv yoxdur',

  'packing.takenCareOf': '{name} cavabdehdir',
  'packing.sharedWithCount': '{count} nəfərlə paylaşılıb',
  'packing.broughtBy': '{name} gətirir',
  'packing.alsoBring': 'Mən də bunu gətirə bilərəm',
  'packing.alsoBringingStop': 'Mən bunu gətirməyəcəyəm',
  'packing.cloneToMine': 'Mənim siyahıma köçür',

  'packing.confirm.clearChecked':
    'İşarələnmiş {count} elementi silmək istədiyinizə əminsiniz?',
  'packing.confirm.deleteCat':
    '“{name}” siyahısını daxilindəki {count} elementlə birlikdə silmək istədiyinizə əminsiniz?',

  'packing.defaultCategory': 'Digər',
  'packing.toast.saveError': 'Yadda saxlamaq mümkün olmadı',
  'packing.toast.deleteError': 'Silmək mümkün olmadı',
  'packing.toast.renameError': 'Adını dəyişmək mümkün olmadı',
  'packing.toast.addError': 'Əlavə etmək mümkün olmadı',

  'packing.suggestions.items': [
    {
      name: 'Pasport',
      category: 'Sənədlər',
    },
    {
      name: 'Şəxsiyyət vəsiqəsi',
      category: 'Sənədlər',
    },
    {
      name: 'Səyahət sığortası',
      category: 'Sənədlər',
    },
    {
      name: 'Uçuş biletləri',
      category: 'Sənədlər',
    },
    {
      name: 'Kredit kartı',
      category: 'Maliyyə',
    },
    {
      name: 'Nağd pul',
      category: 'Maliyyə',
    },
    {
      name: 'Viza',
      category: 'Sənədlər',
    },
    {
      name: 'Köynəklər',
      category: 'Geyim',
    },
    {
      name: 'Şalvarlar',
      category: 'Geyim',
    },
    {
      name: 'Alt paltarı',
      category: 'Geyim',
    },
    {
      name: 'Corablar',
      category: 'Geyim',
    },
    {
      name: 'Gödəkçə',
      category: 'Geyim',
    },
    {
      name: 'Yuxu geyimi',
      category: 'Geyim',
    },
    {
      name: 'Çimərlik geyimi',
      category: 'Geyim',
    },
    {
      name: 'Yağış gödəkçəsi',
      category: 'Geyim',
    },
    {
      name: 'Rahat ayaqqabı',
      category: 'Geyim',
    },
    {
      name: 'Diş fırçası',
      category: 'Gigiyena vasitələri',
    },
    {
      name: 'Diş məcunu',
      category: 'Gigiyena vasitələri',
    },
    {
      name: 'Şampun',
      category: 'Gigiyena vasitələri',
    },
    {
      name: 'Dezodorant',
      category: 'Gigiyena vasitələri',
    },
    {
      name: 'Günəş kremi',
      category: 'Gigiyena vasitələri',
    },
    {
      name: 'Ülgüc',
      category: 'Gigiyena vasitələri',
    },
    {
      name: 'Şarj cihazı',
      category: 'Elektronika',
    },
    {
      name: 'Powerbank',
      category: 'Elektronika',
    },
    {
      name: 'Qulaqlıq',
      category: 'Elektronika',
    },
    {
      name: 'Səyahət adapteri',
      category: 'Elektronika',
    },
    {
      name: 'Kamera',
      category: 'Elektronika',
    },
    {
      name: 'Ağrıkəsici',
      category: 'Sağlamlıq',
    },
    {
      name: 'Yara plastırı',
      category: 'Sağlamlıq',
    },
    {
      name: 'Dezinfeksiya vasitəsi',
      category: 'Sağlamlıq',
    },
  ],

  'packing.bagLimit': 'Çəki limiti',
  'packing.setBagLimit': 'Limit təyin et',
};

export default packing;