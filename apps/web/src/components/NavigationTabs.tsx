import { Bookmark, List, MapPin } from 'lucide-react'
import type { Screen } from '../hooks/useNavigation'

const tabs = [
  { id: 'nearby', label: 'Nearby', icon: MapPin },
  { id: 'routes', label: 'Routes', icon: List },
  { id: 'saved', label: 'Saved', icon: Bookmark },
] as const

export function NavigationTabs({ screen, variant, onSelect }: { screen: Screen; variant: 'external' | 'inline'; onSelect: (screen: Screen) => void }) {
  return <nav className={`nav-bar ${variant}-tabs`} aria-label="Main navigation">
    {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={screen === id ? 'active' : ''} onClick={() => onSelect(id)} aria-current={screen === id ? 'page' : undefined}>
      <Icon size={20} aria-hidden="true" /><span>{label}</span>
    </button>)}
  </nav>
}
