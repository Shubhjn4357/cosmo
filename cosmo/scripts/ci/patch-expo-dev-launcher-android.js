#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const packageDir = path.join(rootDir, 'node_modules', 'expo-dev-launcher');
const androidDir = path.join(packageDir, 'android');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function applyReplacePatch(filePath, before, after, label) {
  const current = read(filePath);

  if (current.includes(after)) {
    console.log(`[expo-dev-launcher patch] ${label}: already patched`);
    return;
  }

  if (!current.includes(before)) {
    throw new Error(`[expo-dev-launcher patch] ${label}: expected source snippet not found in ${filePath}`);
  }

  write(filePath, current.replace(before, after));
  console.log(`[expo-dev-launcher patch] ${label}: patched`);
}

function main() {
  if (!fs.existsSync(androidDir)) {
    console.log('[expo-dev-launcher patch] package not installed, skipping');
    return;
  }

  const getUpdatesGraphql = path.join(androidDir, 'src', 'main', 'graphql', 'GetUpdates.graphql');
  const getBranchesGraphql = path.join(androidDir, 'src', 'main', 'graphql', 'GetBranches.graphql');
  const apolloClientService = path.join(
    androidDir,
    'src',
    'debug',
    'java',
    'expo',
    'modules',
    'devlauncher',
    'services',
    'ApolloClientService.kt'
  );
  const branchViewModel = path.join(
    androidDir,
    'src',
    'debug',
    'java',
    'expo',
    'modules',
    'devlauncher',
    'compose',
    'models',
    'BranchViewModel.kt'
  );

  applyReplacePatch(
    getUpdatesGraphql,
    `          runtimeVersion\n`,
    `          runtime {\n            version\n          }\n`,
    'GetUpdates.graphql runtime field'
  );

  applyReplacePatch(
    getBranchesGraphql,
    `          runtimeVersion\n`,
    `          runtime {\n            version\n          }\n`,
    'GetBranches.graphql runtime field'
  );

  applyReplacePatch(
    getBranchesGraphql,
    `query getBranches(\n  $appId: String!\n  $offset: Int!\n  $limit: Int!\n  $platform: AppPlatform!\n) {\n`,
    `query getBranches(\n  $appId: String!\n  $offset: Int!\n  $limit: Int!\n) {\n`,
    'GetBranches.graphql remove unused platform variable'
  );

  applyReplacePatch(
    apolloClientService,
    `      GetBranchesQuery(\n        appId = appId,\n        offset = offset,\n        limit = limit,\n        platform = AppPlatform.ANDROID\n      )\n`,
    `      GetBranchesQuery(\n        appId = appId,\n        offset = offset,\n        limit = limit\n      )\n`,
    'ApolloClientService GetBranchesQuery constructor'
  );

  applyReplacePatch(
    branchViewModel,
    `        isCompatible = update.runtimeVersion == runtimeVersion,\n`,
    `        isCompatible = update.runtime.version == runtimeVersion,\n`,
    'BranchViewModel compatibility check'
  );
}

main();
