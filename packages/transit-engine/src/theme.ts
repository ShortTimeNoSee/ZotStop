export const themes = {
  light: {
    page: '#ffffff',
    card: '#ffffff',
    text: '#0f1117',
    text2: '#3d4452',
    text3: '#68737f',
    border: '#dde1e8',
    surface: '#f5f6f8',
    action: '#1d4ed8',
    street: '#eef0ef',
    road: '#ffffff',
    label: '#52615f',
    labelHalo: '#ffffff',
  },
  dark: {
    page: '#12151a',
    card: '#1c222c',
    text: '#f4f6f8',
    text2: '#d5dbe3',
    text3: '#b7c0cb',
    border: '#3a4352',
    surface: '#262d38',
    action: '#93c5fd',
    street: '#1a1f26',
    road: '#2e3642',
    label: '#d5ddd8',
    labelHalo: '#12151a',
  },
} as const

export type ThemeName = keyof typeof themes
