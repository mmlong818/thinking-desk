// Task output adapters: TaskOutput → { drafts, replace } for Repository.saveRunOutput.
export type { AdaptedOutput } from './common';
export { adaptExtractBrief, BRIEF_COMPLETENESS_THRESHOLD, type ExtractBriefContext } from './brief';
export { adaptJobsRefinement, adaptPersonaBatch, adaptUsersAnalysis, JOB_DIMENSIONS } from './users';
export { adaptStakeholders } from './stakeholders';
export { adaptAlternatives } from './alternatives';
export { adaptDeepAnalysis, adaptDimensions, adaptScenarioDrafts } from './scenarios';
export { adaptFeatureList } from './features';
export { adaptLeapAnalysis, adaptMoreLeapItems } from './leap';
export { adaptDesignProposal, adaptFeatureRevision, type ReviseFeaturesContext } from './final';
export { adaptSubfeatureBreakdown } from './split';
export { adaptConsistencyCheck, CONSISTENCY_SCOPES, type ConsistencyContext } from './consistency';
