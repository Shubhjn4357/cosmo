const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Custom Expo config plugin to copy ProGuard rules to the Android build
 */
const withCustomProguard = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const proguardRulesPath = path.join(config.modRequest.projectRoot, 'proguard-rules.pro');
      const androidProguardPath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro'
      );

      // Copy custom ProGuard rules to android/app/
      if (fs.existsSync(proguardRulesPath)) {
        const customRules = fs.readFileSync(proguardRulesPath, 'utf8');
        const existingRules = fs.existsSync(androidProguardPath)
          ? fs.readFileSync(androidProguardPath, 'utf8')
          : '';
        
        // Append custom rules to existing ones
        fs.writeFileSync(androidProguardPath, existingRules + '\n' + customRules);
      }

      return config;
    },
  ]);
};

module.exports = withCustomProguard;
