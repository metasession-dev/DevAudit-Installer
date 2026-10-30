export { detectStack, PYTHON_MARKERS, SKIP_DIRS, type DetectedStack } from './stack.js';
export { detectTestRunners, playwrightProjectNames, PLAYWRIGHT_CONFIGS, type TestRunnerDetection } from './test-runners.js';
export {
  hostEvidenceFromFiles,
  rankHostEvidence,
  HOST_FILE_SIGNALS,
  type DeployConfidence,
  type DeployEvidence,
  type DetectedHost,
} from './deploy.js';
export {
  dependentProjectsFromConfig,
  detectDependentProjects,
  detectSeedScripts,
  detectTestData,
  type TestDataFacts,
} from './test-data.js';
export {
  detectBranches,
  detectFacts,
  detectGovernanceFiles,
  detectRunner,
  detectTestGroups,
  type DetectedFacts,
  type DetectOptions,
  type TestGroups,
} from './facts.js';
