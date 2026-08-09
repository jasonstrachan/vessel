import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const getVesselCollaborationJournalPath = (session) =>
  path.join(os.tmpdir(), `vessel-collab-${session}-journal.jsonl`);

export const getVesselCollaborationResultPath = (session, commandId) =>
  path.join(os.tmpdir(), `vessel-collab-${session}-result-${commandId}.json`);

export const writeVesselCollaborationJournalResult = async (session, commandId, result) => {
  const resultPath = getVesselCollaborationResultPath(session, commandId);
  const temporaryPath = `${resultPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(result)}\n`, { mode: 0o600 });
    await fs.rename(temporaryPath, resultPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return resultPath;
};

export const readVesselCollaborationJournalResult = async (session, commandId) => {
  try {
    return JSON.parse(await fs.readFile(
      getVesselCollaborationResultPath(session, commandId),
      'utf8',
    ));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
};

export const appendVesselCollaborationJournal = async (session, event) => {
  const journalPath = getVesselCollaborationJournalPath(session);
  await fs.appendFile(
    journalPath,
    `${JSON.stringify({ recordedAt: new Date().toISOString(), ...event })}\n`,
    { mode: 0o600 },
  );
};

export const readVesselCollaborationJournal = async (session) => {
  const journalPath = getVesselCollaborationJournalPath(session);
  let text;
  try {
    text = await fs.readFile(journalPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { journalPath, commands: [] };
    throw error;
  }
  const commands = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event.commandId) continue;
    const previous = commands.get(event.commandId) ?? {
      commandId: event.commandId,
      status: 'unknown',
    };
    if (event.type === 'accepted') {
      commands.set(event.commandId, {
        ...previous,
        requestId: event.requestId,
        action: event.action,
        runtimeFence: event.runtimeFence,
        ...(event.commandSignatureHash ? { commandSignatureHash: event.commandSignatureHash } : {}),
        status: 'accepted',
      });
    } else if (event.type === 'delivered') {
      commands.set(event.commandId, { ...previous, status: 'delivered' });
    } else if (event.type === 'cancel-requested') {
      commands.set(event.commandId, { ...previous, status: 'cancel-requested' });
    } else if (event.type === 'completed') {
      commands.set(event.commandId, {
        ...previous,
        status: 'completed',
        ok: event.ok,
        revision: event.revision,
        projectId: event.projectId,
        outcome: event.outcome,
        ...(event.resultSignatureHash ? { resultSignatureHash: event.resultSignatureHash } : {}),
      });
    }
  }
  return { journalPath, commands: [...commands.values()] };
};
