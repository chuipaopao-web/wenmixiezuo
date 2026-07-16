export type WorkspaceTheme = 'sage' | 'paper' | 'mist' | 'night';
export type WorkspaceFontSize = 'small' | 'standard' | 'large' | 'xlarge';

export interface WorkspacePreferences {
  theme: WorkspaceTheme;
  fontSize: WorkspaceFontSize;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  theme: 'sage',
  fontSize: 'standard'
};

export const FONT_SCALE: Record<WorkspaceFontSize, number> = {
  small: 0.92,
  standard: 1,
  large: 1.1,
  xlarge: 1.2
};

const STORAGE_KEY = 'wenmi:workspace-preferences';
const THEMES: WorkspaceTheme[] = ['sage', 'paper', 'mist', 'night'];
const FONT_SIZES: WorkspaceFontSize[] = ['small', 'standard', 'large', 'xlarge'];

export function readWorkspacePreferences(): WorkspacePreferences {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_WORKSPACE_PREFERENCES;
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<WorkspacePreferences>;
    return {
      theme: THEMES.includes(stored.theme as WorkspaceTheme) ? stored.theme as WorkspaceTheme : DEFAULT_WORKSPACE_PREFERENCES.theme,
      fontSize: FONT_SIZES.includes(stored.fontSize as WorkspaceFontSize) ? stored.fontSize as WorkspaceFontSize : DEFAULT_WORKSPACE_PREFERENCES.fontSize
    };
  } catch {
    return DEFAULT_WORKSPACE_PREFERENCES;
  }
}

export function saveWorkspacePreferences(preferences: WorkspacePreferences): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 受限 WebView 可能禁用本地存储；设置仍在当前会话生效。
  }
}
