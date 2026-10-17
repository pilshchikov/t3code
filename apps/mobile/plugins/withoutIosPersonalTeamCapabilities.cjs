const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutIosPersonalTeamCapabilities(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults["aps-environment"];
    delete modConfig.modResults["com.apple.developer.applesignin"];
    // The relying party only trusts T3 Tools' bundle identifiers.
    delete modConfig.modResults["com.apple.developer.associated-domains"];
    delete modConfig.modResults["com.apple.security.application-groups"];
    return modConfig;
  });
};
