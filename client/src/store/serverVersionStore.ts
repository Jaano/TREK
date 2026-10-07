import { create } from 'zustand'
import { asReleaseTag } from '../utils/versionHandover'

/**
 * The version the server says it runs, as its realtime socket reports it on
 * every (re)connect. A deploy restarts the server, so a client that stayed open
 * across one reconnects and learns the new version here (NewVersionNotice).
 */
interface ServerVersionState {
  /** The last version the server reported, or null before its first report. */
  reported: string | null
  /** Takes what the welcome frame carries; anything but a release tag is ignored. */
  note: (value: unknown) => void
}

export const useServerVersionStore = create<ServerVersionState>()((set, get) => ({
  reported: null,
  note(value) {
    const version = asReleaseTag(value)
    if (version && version !== get().reported) set({ reported: version })
  },
}))
