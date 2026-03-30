// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Production optimizations
if (process.env.NODE_ENV === 'production') {
  // Enable minification
  config.transformer = {
    ...config.transformer,
    minifierConfig: {
      compress: {
        // Remove console logs in production
        drop_console: true,
        // Remove debugger statements
        drop_debugger: true,
        // More aggressive optimizations
        passes: 3,
      },
      mangle: {
        toplevel: true,
      },
      output: {
        comments: false,
        ascii_only: true,
      },
    },
  };
}

module.exports = config;
