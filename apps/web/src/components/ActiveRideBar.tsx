import type { RideGuidance } from '@zotstop/transit-engine'

type Props = {
  letter: string
  guidance: RideGuidance
  note: string
  sound: boolean
  onToggleSound: () => void
  onEnd: () => void
}

export function ActiveRideBar({ letter, guidance, note, sound, onToggleSound, onEnd }: Props) {
  const urgent = guidance.stage === 'now' || guidance.stage === 'passed'
  return (
    <section className={`active-ride stage-${guidance.stage}`} aria-label="Active ride">
      <div className="active-ride-copy">
        <strong>{letter} Line to {guidance.destinationName}</strong>
        <p key={`${guidance.stage}:${guidance.message}`} role={urgent ? 'alert' : 'status'}>{guidance.message}</p>
        {note && <p className="active-ride-note">{note}</p>}
      </div>
      <div className="active-ride-actions">
        <button type="button" aria-pressed={sound} onClick={onToggleSound}>{sound ? 'Sound on' : 'Sound off'}</button>
        <button type="button" onClick={onEnd}>End ride</button>
      </div>
    </section>
  )
}
