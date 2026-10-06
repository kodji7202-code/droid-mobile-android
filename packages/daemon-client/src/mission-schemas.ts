/**
 * SDK mission schemas for tests and fixtures only (the dev fixture route and
 * Vitest). Kept off the package root so production code cannot reach for them.
 */
export {
  MissionFeatureSchema,
  MissionFeaturesChangedNotificationSchema,
  MissionHeartbeatNotificationSchema,
  MissionProgressEntryNotificationSchema,
  MissionSnapshotSchema,
  MissionStateChangedNotificationSchema,
  MissionWorkerCompletedNotificationSchema,
  MissionWorkerStartedNotificationSchema,
  ProposeMissionConfirmationDetailsSchema,
  StartMissionRunConfirmationDetailsSchema,
} from '@factory/droid-sdk';
