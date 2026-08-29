/**
 * Downward adapter — settings HTTP lives in backend/http/settings/.
 */
export {
  dispatchSettingsHttpRoutes as handleSettingsRequest,
  handleSettingsApi,
} from '../../backend/http/settings/index.js';
