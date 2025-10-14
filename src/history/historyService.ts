import HistoryManager from './historyManager';

const historyManager = new HistoryManager({ maxEntries: 50 });

let activeDocumentId = 'default-document';

historyManager.setDocIdResolver(() => activeDocumentId);

export const setActiveHistoryDocument = (docId: string): void => {
  activeDocumentId = docId;
};

export default historyManager;
