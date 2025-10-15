import HistoryManager from './historyManager';

// eslint-disable-next-line no-console
console.log('HistoryManager debug', typeof HistoryManager, HistoryManager);

const HistoryManagerCtor =
  typeof HistoryManager === 'function'
    ? HistoryManager
    : ((HistoryManager as unknown as { default?: typeof HistoryManager }).default ??
        (() => {
          throw new Error('Unable to resolve HistoryManager constructor');
        })) as typeof HistoryManager;

const historyManager = new HistoryManagerCtor({ maxEntries: 50 });

let activeDocumentId = 'default-document';

historyManager.setDocIdResolver(() => activeDocumentId);

export const setActiveHistoryDocument = (docId: string): void => {
  activeDocumentId = docId;
};

export default historyManager;
