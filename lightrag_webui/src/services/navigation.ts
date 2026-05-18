import { NavigateFunction } from 'react-router-dom';
import { useAuthStore, useBackendState } from '@/stores/state';
import { useGraphStore } from '@/stores/graph';
import { useSettingsStore } from '@/stores/settings';

class NavigationService {
  private navigate: NavigateFunction | null = null;

  setNavigate(navigate: NavigateFunction) {
    this.navigate = navigate;
  }

  /**
   * Reset all application state to ensure a clean environment.
   * This function should be called when:
   * 1. User logs out
   * 2. Authentication token expires
   * 3. Direct access to login page
   *
   * @param preserveHistory If true, chat history will be preserved. Default is false.
   */
  resetAllApplicationState(preserveHistory = false) {
    console.log('Resetting all application state...');

    // Reset graph state
    const graphStore = useGraphStore.getState();
    const sigma = graphStore.sigmaInstance;
    graphStore.reset();
    graphStore.setGraphDataFetchAttempted(false);
    graphStore.setLabelsFetchAttempted(false);
    graphStore.setSigmaInstance(null);
    graphStore.setIsFetching(false); // Reset isFetching state to prevent data loading issues

    // Reset backend state
    useBackendState.getState().clear();

    // Reset retrieval history message only if preserveHistory is false
    if (!preserveHistory) {
      useSettingsStore.getState().setRetrievalHistory([]);
    }

    // Clear authentication state
    sessionStorage.clear();

    if (sigma) {
      sigma.getGraph().clear();
      sigma.kill();
      useGraphStore.getState().setSigmaInstance(null);
    }
  }

  /**
   * Navigate to login page and reset application state
   */
  navigateToLogin() {
    if (!this.navigate) {
      console.error('Navigation function not set');
      return;
    }

    this.resetAllApplicationState(false);
    useAuthStore.getState().logout();

    this.navigate('/login');
  }

  navigateToHome() {
    if (!this.navigate) {
      console.error('Navigation function not set');
      return;
    }

    this.navigate('/');
  }
}

export const navigationService = new NavigationService();
