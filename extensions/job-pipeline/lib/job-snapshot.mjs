export function rebuildSnapshotFromEvents(events) {
  const sortedEvents = [...(Array.isArray(events) ? events : [])]
    .filter((event) => event && typeof event === 'object' && typeof event.type === 'string')
    .sort((left, right) => Number(left.seq ?? 0) - Number(right.seq ?? 0));

  return sortedEvents.reduce((snapshot, event) => reduceJobEvent(snapshot, event), {});
}

export function reduceJobEvent(previousSnapshot, event) {
  const snapshot = {
    ...normalizeSnapshot(previousSnapshot),
  };
  const { type, data = {}, recordedAt } = event;

  switch (type) {
    case 'RUN_CREATED': {
      snapshot.id = data.id;
      snapshot.description = data.description ?? '';
      snapshot.cwd = data.cwd ?? '';
      snapshot.step = data.step ?? 'interview';
      snapshot.createdAt = Number(data.createdAt ?? recordedAt ?? Date.now());
      snapshot.cycleIndex = Number(data.cycleIndex ?? 1);
      snapshot.replanCount = Number(data.replanCount ?? 0);
      break;
    }

    case 'INTERVIEW_CAPTURED': {
      snapshot.spec = data.spec;
      snapshot.step = data.step ?? snapshot.step;
      snapshot.pausedGate = undefined;
      break;
    }

    case 'POOL_DRAWN': {
      snapshot.pool = data.pool;
      break;
    }

    case 'GATE_DENIED': {
      snapshot.pausedGate = data.gate;
      snapshot.step = data.step ?? snapshot.step;
      break;
    }

    case 'GATE_APPROVED': {
      if (snapshot.pausedGate === data.gate) {
        snapshot.pausedGate = undefined;
      }
      snapshot.step = data.step ?? snapshot.step;
      break;
    }

    case 'STAGE_COMPLETED': {
      applyStageCompleted(snapshot, data);
      break;
    }

    case 'TASK_FAILED': {
      snapshot.lastError = {
        type: 'task-failed',
        taskId: data.taskId,
        ...data.failureReport,
      };
      break;
    }

    case 'REPLAN_REQUESTED': {
      snapshot.replanCount = Number(data.replanCount ?? snapshot.replanCount ?? 0);
      snapshot.step = data.step ?? 'planning';
      snapshot.lastError = { reason: data.reason ?? 'replan requested' };
      clearPlanningOutputs(snapshot);
      break;
    }

    case 'PROOF_WRITTEN': {
      snapshot.proofDeckPath = data.proofDeckPath;
      break;
    }

    case 'REVIEW_COMPLETED': {
      snapshot.reviewVerdict = data.reviewVerdict;
      snapshot.reviewNotes = data.reviewNotes;
      snapshot.reviewFindings = data.reviewFindings;
      snapshot.reviewMissingTests = data.reviewMissingTests;
      snapshot.reviewOpenQuestions = data.reviewOpenQuestions;
      break;
    }

    case 'CYCLE_INCREMENTED': {
      snapshot.cycleIndex = Number(data.cycleIndex ?? (snapshot.cycleIndex ?? 1) + 1);
      if (data.reason === 'proof-review-denied') {
        snapshot.previousProofDeckPath = snapshot.proofDeckPath;
        snapshot.proofDeckPath = undefined;
        snapshot.workerResults = undefined;
        snapshot.reviewVerdict = undefined;
        snapshot.reviewNotes = undefined;
        snapshot.reviewFindings = undefined;
        snapshot.reviewMissingTests = undefined;
        snapshot.reviewOpenQuestions = undefined;
        snapshot.reviewEvidenceSummary = undefined;
        snapshot.reviewJesterCritique = undefined;
        snapshot.plannerResolution = undefined;
        snapshot.pausedGate = undefined;
      }
      snapshot.step = data.step ?? snapshot.step;
      break;
    }

    default:
      break;
  }

  if (snapshot.createdAt === undefined) {
    snapshot.createdAt = Number(recordedAt ?? Date.now());
  }
  snapshot.updatedAt = Number(recordedAt ?? snapshot.updatedAt ?? Date.now());
  return snapshot;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { cycleIndex: 1, replanCount: 0 };
  }

  return {
    cycleIndex: Number(snapshot.cycleIndex ?? 1),
    replanCount: Number(snapshot.replanCount ?? 0),
    ...snapshot,
  };
}

function applyStageCompleted(snapshot, data) {
  switch (data.stage) {
    case 'planning': {
      if (data.result?.finalPlan !== undefined) {
        snapshot.finalPlan = data.result.finalPlan;
      }
      if (data.result?.planCritiques !== undefined) {
        snapshot.planCritiques = data.result.planCritiques;
      }
      snapshot.step = data.step ?? snapshot.step;
      break;
    }

    case 'task-writing': {
      if (data.result?.taskGraph !== undefined) {
        snapshot.taskGraph = data.result.taskGraph;
      }
      snapshot.step = data.step ?? snapshot.step;
      break;
    }

    default:
      break;
  }
}

function clearPlanningOutputs(snapshot) {
  snapshot.finalPlan = undefined;
  snapshot.planCritiques = undefined;
  snapshot.taskGraph = undefined;
  snapshot.plannerUiAssessment = undefined;
  snapshot.uiRequired = undefined;
  snapshot.uiDetectionReasons = undefined;
  snapshot.uiDesign = undefined;
}
