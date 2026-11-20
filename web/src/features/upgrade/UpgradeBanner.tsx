import { Link } from 'react-router-dom';
import { Banner } from '../../components/Banner.js';
import { routes } from '../../app/routes.js';
import { useUpgradePaused } from './watch.js';

/** "Paused for upgrade": shown after the first action the installation refused during an upgrade. */
export function UpgradeBanner() {
  if (!useUpgradePaused()) return null;
  return (
    <Banner
      tone="warning"
      className="upgrade-banner"
      title="Beetle is paused for an upgrade"
      actions={<Link to={routes.upgradeSettings}>Upgrade status</Link>}
    >
      You can read everything and cancel running work. New runs, uploads and changes wait until the upgrade is
      activated or rolled back on the host.
    </Banner>
  );
}
