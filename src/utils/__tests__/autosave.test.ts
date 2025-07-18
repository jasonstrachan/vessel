// Test suite for autosave functionality

import { autosaveService } from '../autosave';
import { useAppStore } from '../../stores/useAppStore';

// Mock the store to avoid browser dependencies
jest.mock('../../stores/useAppStore', () => ({
  useAppStore: {
    getState: jest.fn(),
    setState: jest.fn()
  }
}));

describe('AutosaveService', () => {
  let mockStore: any;

  beforeEach(() => {
    mockStore = {
      autosave: {
        isEnabled: true,
        hasUnsavedChanges: true,
        isRunning: false
      },
      project: {
        id: 'test-project',
        name: 'Test Project'
      },
      saveProject: jest.fn().mockResolvedValue(undefined),
      addNotification: jest.fn()
    };

    (useAppStore.getState as jest.Mock).mockReturnValue(mockStore);
    (useAppStore.setState as jest.Mock).mockImplementation(() => {});

    // Reset service state
    autosaveService.stop();
  });

  afterEach(() => {
    autosaveService.stop();
    jest.clearAllMocks();
  });

  it('should start autosave service', () => {
    autosaveService.start();
    
    expect(useAppStore.setState).toHaveBeenCalledWith(
      expect.any(Function)
    );
    expect(autosaveService.isRunning()).toBe(true);
  });

  it('should stop autosave service', () => {
    autosaveService.start();
    autosaveService.stop();
    
    expect(autosaveService.isRunning()).toBe(false);
  });

  it('should change interval', () => {
    const originalInterval = 2; // 2 minutes default
    const newInterval = 5; // 5 minutes
    
    autosaveService.setInterval(newInterval);
    
    // If running, it should restart with new interval
    autosaveService.start();
    expect(autosaveService.isRunning()).toBe(true);
  });

  it('should perform autosave when conditions are met', async () => {
    await autosaveService.triggerAutosave();
    
    expect(mockStore.saveProject).toHaveBeenCalled();
  });

  it('should not perform autosave when disabled', async () => {
    mockStore.autosave.isEnabled = false;
    
    await autosaveService.triggerAutosave();
    
    expect(mockStore.saveProject).not.toHaveBeenCalled();
  });

  it('should not perform autosave when no unsaved changes', async () => {
    mockStore.autosave.hasUnsavedChanges = false;
    
    await autosaveService.triggerAutosave();
    
    expect(mockStore.saveProject).not.toHaveBeenCalled();
  });

  it('should not perform autosave when no project', async () => {
    mockStore.project = null;
    
    await autosaveService.triggerAutosave();
    
    expect(mockStore.saveProject).not.toHaveBeenCalled();
  });

  it('should handle save errors gracefully', async () => {
    mockStore.saveProject.mockRejectedValue(new Error('Save failed'));
    
    await autosaveService.triggerAutosave();
    
    expect(mockStore.addNotification).toHaveBeenCalledWith({
      type: 'warning',
      title: 'Autosave Failed',
      message: 'Could not automatically save your project. Please save manually.',
      timestamp: expect.any(Date),
      duration: 5000
    });
  });
});