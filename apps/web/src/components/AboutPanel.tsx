import { ArrowRight } from 'lucide-react'
import { officialUpdatesUrl } from '@zotstop/transit-engine'

type Props = { uxEnabled: boolean; onToggle: (enabled: boolean) => void }

export function AboutPanel({ uxEnabled, onToggle }: Props) {
  return (
    <>
      <div className="page-title">
        <span className="eyebrow eyebrow-blue">ABOUT ZOTSTOP</span>
        <h1>
          About ZotStop<span>.</span>
        </h1>
        <p>A simpler way to follow campus buses.</p>
      </div>
      <div className="about-card">
        <h2>About live times</h2>
        <p>
          Bus positions and arrival estimates come from the transit operator. A
          delayed position can make an arrival time unreliable. ZotStop shows
          when updates are old and removes countdowns it cannot support. When a
          bus has recently taken longer than scheduled between timing points,
          downstream arrivals may appear as a wider time range. The range is
          guidance about changing traffic, not a guaranteed probability.
          Gold areas on the map are recent rider reports. They need two ride
          sessions and show only an approximate location. They are unverified
          and do not change the operator’s arrival estimates.
        </p>
      </div>
      <div className="about-card">
        <h2>Privacy</h2>
        <p>
          Finding nearby stops uses your location on this device. Saved stops
          also stay here. If you choose Share ride, precise fixes go to
          ZotStop’s relay while this app is open. The relay checks each fix
          against the route and stores coarse route progress with a random ride
          ID for about 20 minutes. It does not store the exact fix. Cloudflare
          may retain recoverable history of that coarse progress for 30 days.
          The relay can see your IP address when it receives a report. Stop
          sharing at any time.
          Randomized usage counts are separate, optional, and off by default.
        </p>
      </div>
      <div className="about-card">
        <h2>Help improve ZotStop</h2>
        <p>
          If you choose to share usage counts, the app sends a few randomized
          yes or no answers about how quickly you found a route or stop. The
          report contains no route names, locations, or device identifier. The
          relay can see your IP address when it receives the report. You can
          turn this off at any time.
        </p>
        <label className="consent-toggle">
          <input
            type="checkbox"
            checked={uxEnabled}
            onChange={(event) => onToggle(event.target.checked)}
          />{' '}
          Share randomized usage counts
        </label>
      </div>
      <div className="about-card">
        <h2>Made by Nicholas Thompson</h2>
        <p>
          Nicholas is a Cognitive Sciences major who transferred from Butte
          College. He cares about privacy, performance, and making everyday
          tools easier to use.
        </p>
        <a
          href="https://github.com/ShortTimeNoSee/ZotStop"
          target="_blank"
          rel="noreferrer"
        >
          Source code <ArrowRight size={16} />
        </a>
        <a
          href="https://github.com/ShortTimeNoSee/ZotStop/issues"
          target="_blank"
          rel="noreferrer"
        >
          Send feedback <ArrowRight size={16} />
        </a>
      </div>
      <div className="about-card">
        <h2>Service information</h2>
        <p>
          Routes and stops come from the operator’s public transit feed. Check
          official service updates for detours, holidays, and temporary changes.
        </p>
        <a
          href={officialUpdatesUrl}
          target="_blank"
          rel="noreferrer"
        >
          View official updates <ArrowRight size={16} />
        </a>
      </div>
      <p className="independent-note">
        ZotStop is an independent project and is not affiliated with UC Irvine
        or Anteater Express.
      </p>
    </>
  )
}
