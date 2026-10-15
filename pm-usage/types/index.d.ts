export type Row = { pm: string; pct: number | null; state: string }
export type Usage = { at: string; rows: Row[]; error: string | null }
declare module 'claude-code' {
  interface PluginState {
    'pm-usage': { usage: Usage | null; hidden: boolean }
  }
}
