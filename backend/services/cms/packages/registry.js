/** Compact package metadata merge for cms_themes.tokens_json. */
export function mergeCmsThemePackageMeta(tokensJsonStr, packageMeta) {
  let obj = {};
  try {
    if (tokensJsonStr != null && String(tokensJsonStr).trim() !== '') {
      const parsed = JSON.parse(String(tokensJsonStr));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
    }
  } catch {
    obj = {};
  }
  obj.package_meta = { ...packageMeta };
  return JSON.stringify(obj);
}
