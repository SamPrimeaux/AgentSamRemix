import assert from 'node:assert/strict';
import { handleCmsPageRoutes } from './pages.js';
import { handleCmsAssetRoutes } from './assets.js';
import { handleCmsThemeRoutes } from './themes.js';
const base={method:'POST',path:'/api/cms/site-shell/header/publish',url:new URL('https://x/api/cms/site-shell/header/publish'),request:new Request('https://x/api/cms/site-shell/header/publish',{method:'POST'}),env:{},ctx:{},authUser:{id:'u'}};
assert.equal(await handleCmsPageRoutes(base),null,'page transport must not claim site-shell publish');
assert.equal(await handleCmsAssetRoutes({...base,path:'/api/cms/nope'}),null);
assert.equal(await handleCmsThemeRoutes({...base,path:'/api/cms/nope'}),null);
console.log('cms-route ownership tests: OK');
