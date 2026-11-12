import FibreArc from './FibreArc'
import GlitterCascade from './GlitterCascade'
import { usePreferences } from '../lib/preferences'

/**
 * The persistent VYRA backdrop, mounted once in the app shell so it survives
 * every route change: the supplied Glitter Cascade shader layer (original preset
 * configuration) underneath the Fibre Arc layer (screened over it), with a light
 * scrim for text contrast. Pointer events stay disabled; both effects listen on
 * the window, pause offscreen or on a hidden tab, and freeze when background
 * motion is switched off in Settings.
 */
export default function SceneBackground() {
  const { prefs } = usePreferences()
  const moving = prefs.backgroundEffects

  return (
    <div className="scene-bg" aria-hidden="true">
      <div className="scene-bg__glitter">
        <GlitterCascade background="#090811" speed={moving ? 100 : 0} />
      </div>
      <div className="scene-bg__arc">
        <FibreArc
          intensity={1}
          paused={!moving}
          background="#090811"
          baseColor="#7C5CFF"
          accentColor="#C9B8FF"
          highlight="#F7F2FF"
          speed={30}
          density={22}
          hover={110}
          reach={34}
          bundle={{ comb: 140, curve: 320, spread: 260, thickness: 70 }}
        />
      </div>
      <div className="scene-bg__scrim" />
    </div>
  )
}
