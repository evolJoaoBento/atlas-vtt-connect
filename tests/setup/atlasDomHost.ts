// Atlas's 3D dice draw through a DOM host (API 1.17.0); the tests get the join page's, as `online-client/main.mts` installs it.
// Imported in `beforeAll`, after the test file's own imports: a test that mocks three.js (`vi.mock('three')`) gets the dice
// built on its mock, which a static import here, evaluated before the test file's mocks, would bypass.
import { beforeAll } from 'vitest';
import { browserDomHost } from '../../online-client/dice3d/browserDomHost.mts';

beforeAll(async () => {
  const { installDomHost } = await import('@atlas-vtt/shared/dice3d');
  installDomHost(browserDomHost());
});
