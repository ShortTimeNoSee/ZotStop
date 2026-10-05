import { ArrowRight } from 'lucide-react'
import { officialUpdatesUrl } from '@zotstop/transit-engine'

type Props = { uxEnabled: boolean; onToggle: (enabled: boolean) => void }

export function InfoPanel({ uxEnabled, onToggle }: Props) {
  return (
    <>
      <div className="info-section">
        <h3>About live times</h3>
        <p>
          Bus positions and arrival estimates come from the transit operator. A delayed position
          can make an arrival time unreliable. ZotStop shows when updates are old and removes
          countdowns it cannot support. When a bus has recently taken longer than scheduled between
          timing points, downstream arrivals may appear as a wider time range. That range reflects
          changing traffic, not a guaranteed probability. Gold areas on the map are recent rider
          reports -- approximate, unverified, and not used to change arrival estimates.
        </p>
      </div>

      <div className="info-section">
        <h3>Privacy</h3>
        <p>
          Finding nearby stops uses your location on this device only. Saved stops also stay here.
          Get-off alerts are a separate choice. Follow with this phone, or select the bus whose
          fleet name is printed on the vehicle. A bus alert uses the operator's position, which can
          arrive late. A phone alert stays on this device and checks a reported bus only when exactly
          one is close. The alert can continue in a notification after you leave. If you choose Share ride,
          precise fixes go to ZotStop's relay while this app is open.
          The relay checks each fix against the route and stores coarse route progress with a
          random ride ID for about 20 minutes. It does not store the exact fix. Cloudflare may
          retain recoverable history of that coarse progress for 30 days. The relay can see your
          IP address when it receives a report. Stop sharing at any time.
        </p>
        <p>Randomized usage counts are separate, optional, and off by default.</p>
        <label className="consent-row">
          <input type="checkbox" checked={uxEnabled} onChange={event => onToggle(event.target.checked)} />
          Share randomized usage counts
        </label>
        <p className="info-aside">
          If you turn this on, the app sends a few yes/no answers about how quickly you found a route
          or stop. No route names, locations, or device identifier are included.
        </p>
      </div>

      <div className="info-columns">
      <div className="info-section">
        <h3>Made by Nicholas Thompson</h3>
        <p>
          Nicholas is a Cognitive Sciences major who transferred from Butte College. He cares about
          privacy, performance, and making everyday tools easier to use.
        </p>
        <a href="https://github.com/ShortTimeNoSee/ZotStop" target="_blank" rel="noreferrer">
          Source code <ArrowRight size={14} />
        </a>
        <a href="https://github.com/ShortTimeNoSee/ZotStop/issues" target="_blank" rel="noreferrer">
          Send feedback <ArrowRight size={14} />
        </a>
      </div>

      <div className="info-section">
        <h3>Service information</h3>
        <p>
          Routes and stops come from the operator's public transit feed. Check official service
          updates for detours, holidays, and temporary changes.
        </p>
        <a href={officialUpdatesUrl} target="_blank" rel="noreferrer">
          Official updates <ArrowRight size={14} />
        </a>
      </div>
      </div>

      <p className="independence-note">
        ZotStop is an independent project and is not affiliated with UC Irvine or Anteater Express.
      </p>
    </>
  )
}
