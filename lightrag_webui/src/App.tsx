import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import ThemeProvider from '@/components/ThemeProvider'
import TabVisibilityProvider from '@/contexts/TabVisibilityProvider'
import ApiKeyAlert from '@/components/ApiKeyAlert'
import StatusIndicator from '@/components/status/StatusIndicator'
import { SiteInfo, webuiPrefix } from '@/lib/constants'
import { useBackendState, useAuthStore } from '@/stores/state'
import { useSettingsStore } from '@/stores/settings'
import { getAuthStatus, getWorkspaceMode } from '@/api/lightrag'
import { useWorkspaceStore } from '@/stores/workspace'
import { AppTab, getDefaultTabForMode, getVisibleTabsForMode } from '@/lib/workspaceMode'
import SiteHeader from '@/features/SiteHeader'
import { InvalidApiKeyError, RequireApiKeError } from '@/api/lightrag'
import Button from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'
import { AlertTriangleIcon, RefreshCwIcon, ZapIcon } from 'lucide-react'

import GraphViewer from '@/features/GraphViewer'
import DocumentManager from '@/features/DocumentManager'
import ChunkManagement from '@/features/ChunkManagement'
import EntityManagement from '@/features/EntityManagement'
import SchemaManager from '@/features/SchemaManager'
import RetrievalTesting from '@/features/RetrievalTesting'
import ApiSite from '@/features/ApiSite'
import PromptSettings from '@/features/PromptSettings'
import WorkspaceManagement from '@/features/WorkspaceManagement'
import AnswerLibrary from '@/features/AnswerLibrary'
import AnswerSources from '@/features/AnswerSources'
import AnswerMatching from '@/features/AnswerMatching'
import AnswerStructuredData from '@/features/AnswerStructuredData'
import AnswerTestConsole from '@/features/AnswerTestConsole'
import AnswerAnalytics from '@/features/AnswerAnalytics'
import AnswerHelp from '@/features/AnswerHelp'

import { Tabs, TabsContent } from '@/components/ui/Tabs'

function App() {
  const { t } = useTranslation()
  const message = useBackendState.use.message()
  const enableHealthCheck = useSettingsStore.use.enableHealthCheck()
  const currentTab = useSettingsStore.use.currentTab()
  const currentWorkspaceId = useWorkspaceStore.use.currentWorkspaceId()
  const currentWorkspace = useWorkspaceStore.use.currentWorkspace()
  const workspaces = useWorkspaceStore.use.workspaces()
  const workspaceError = useWorkspaceStore.use.error()
  const workspaceIsLoading = useWorkspaceStore.use.isLoading()
  const fetchWorkspaces = useWorkspaceStore.use.fetchWorkspaces()
  const [apiKeyAlertOpen, setApiKeyAlertOpen] = useState(false)
  const [initializing, setInitializing] = useState(true) // Add initializing state
  const versionCheckRef = useRef(false); // Prevent duplicate calls in Vite dev mode
  const healthCheckInitializedRef = useRef(false); // Prevent duplicate health checks in Vite dev mode
  const effectiveWorkspace = useMemo(
    () => currentWorkspace || workspaces.find((workspace) => workspace.workspace_id === currentWorkspaceId) || null,
    [currentWorkspace, currentWorkspaceId, workspaces]
  )
  const workspaceModeReady = Boolean(effectiveWorkspace) || workspaces.length > 0
  const workspaceMode = useMemo(() => getWorkspaceMode(effectiveWorkspace), [effectiveWorkspace])
  const visibleTabs = useMemo(
    () => (workspaceModeReady ? getVisibleTabsForMode(workspaceMode) : []),
    [workspaceMode, workspaceModeReady]
  )
  const activeTab = useMemo(
    () =>
      workspaceModeReady && !visibleTabs.includes(currentTab)
        ? getDefaultTabForMode(workspaceMode)
        : currentTab,
    [currentTab, visibleTabs, workspaceMode, workspaceModeReady]
  )
  const canShowTab = useCallback((tab: AppTab) => visibleTabs.includes(tab), [visibleTabs])

  const handleApiKeyAlertOpenChange = useCallback((open: boolean) => {
    setApiKeyAlertOpen(open)
    if (!open) {
      useBackendState.getState().clear()
    }
  }, [])

  // Track component mount status with useRef
  const isMountedRef = useRef(true);

  // Set up mount/unmount status tracking
  useEffect(() => {
    isMountedRef.current = true;

    // Handle page reload/unload
    const handleBeforeUnload = () => {
      isMountedRef.current = false;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Health check - can be disabled
  useEffect(() => {
    // Health check function
    const performHealthCheck = async () => {
      try {
        // Only perform health check if component is still mounted
        if (isMountedRef.current) {
          await useBackendState.getState().check();
        }
      } catch (error) {
        console.error('Health check error:', error);
      }
    };

    // Set health check function in the store
    useBackendState.getState().setHealthCheckFunction(performHealthCheck);

    if (!enableHealthCheck || apiKeyAlertOpen) {
      useBackendState.getState().clearHealthCheckTimer();
      return;
    }

    // On first mount or when enableHealthCheck becomes true and apiKeyAlertOpen is false,
    // perform an immediate health check and start the timer
    if (!healthCheckInitializedRef.current) {
      healthCheckInitializedRef.current = true;
    }

    // Start/reset the health check timer using the store
    useBackendState.getState().resetHealthCheckTimer();

    // Component unmount cleanup
    return () => {
      useBackendState.getState().clearHealthCheckTimer();
    };
  }, [enableHealthCheck, apiKeyAlertOpen]);

  // Version check - independent and executed only once
  useEffect(() => {
    const checkVersion = async () => {
      // Prevent duplicate calls in Vite dev mode
      if (versionCheckRef.current) return;
      versionCheckRef.current = true;

      // Check if version info was already obtained in login page
      const versionCheckedFromLogin = sessionStorage.getItem('VERSION_CHECKED_FROM_LOGIN') === 'true';
      if (versionCheckedFromLogin) {
        setInitializing(false); // Skip initialization if already checked
        return;
      }

      try {
        setInitializing(true); // Start initialization

        // Get version info
        const token = sessionStorage.getItem('LIGHTRAG-API-TOKEN');
        const status = await getAuthStatus();

        // If auth is not configured and a new token is returned, use the new token
        if (!status.auth_configured && status.access_token) {
          useAuthStore.getState().login(
            status.access_token, // Use the new token
            true, // Guest mode
            status.core_version,
            status.api_version,
            status.webui_title || null,
            status.webui_description || null
          );
        } else if (token && (status.core_version || status.api_version || status.webui_title || status.webui_description)) {
          // Otherwise use the old token (if it exists)
          const isGuestMode = status.auth_mode === 'disabled' || useAuthStore.getState().isGuestMode;
          useAuthStore.getState().login(
            token,
            isGuestMode,
            status.core_version,
            status.api_version,
            status.webui_title || null,
            status.webui_description || null
          );
        }

        // Set flag to indicate version info has been checked
        sessionStorage.setItem('VERSION_CHECKED_FROM_LOGIN', 'true');
      } catch (error) {
        console.error('Failed to get version info:', error);
      } finally {
        // Ensure initializing is set to false even if there's an error
        setInitializing(false);
      }
    };

    // Execute version check
    checkVersion();
  }, []); // Empty dependency array ensures it only runs once on mount

  const handleTabChange = useCallback(
    (tab: string) => useSettingsStore.getState().setCurrentTab(tab as AppTab),
    []
  )

  useEffect(() => {
    if (!workspaceModeReady) return
    if (!visibleTabs.includes(currentTab)) {
      useSettingsStore.getState().setCurrentTab(getDefaultTabForMode(workspaceMode))
    }
  }, [currentTab, visibleTabs, workspaceMode, workspaceModeReady])

  useEffect(() => {
    if (message) {
      if (message.includes(InvalidApiKeyError) || message.includes(RequireApiKeError)) {
        setApiKeyAlertOpen(true)
      }
    }
  }, [message])

  return (
    <ThemeProvider>
      <TabVisibilityProvider>
        {initializing ? (
          // Loading state while initializing with simplified header
          <div className="flex h-screen w-screen flex-col">
            {/* Simplified header during initialization - matches SiteHeader structure */}
            <header className="border-border/40 bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 flex h-10 w-full border-b px-4 backdrop-blur">
              <div className="min-w-[200px] w-auto flex items-center">
                <a href={webuiPrefix} className="flex items-center gap-2">
                  <ZapIcon className="size-4 text-emerald-400" aria-hidden="true" />
                  <span className="font-bold md:inline-block">{SiteInfo.name}</span>
                </a>
              </div>

              {/* Empty middle section to maintain layout */}
              <div className="flex h-10 flex-1 items-center justify-center">
              </div>

              {/* Empty right section to maintain layout */}
              <nav className="w-[200px] flex items-center justify-end">
              </nav>
            </header>

            {/* Loading indicator in content area */}
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
                <p>Initializing...</p>
              </div>
            </div>
          </div>
        ) : (
          // Main content after initialization
          <main className="flex h-screen w-screen overflow-hidden">
            <Tabs
              value={activeTab}
              className="!m-0 flex grow flex-col !p-0 overflow-hidden"
              onValueChange={handleTabChange}
            >
              <SiteHeader />
              <div className="relative grow">
                {!workspaceModeReady && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm text-muted-foreground">
                    {workspaceError ? (
                      <div className="mx-4 max-w-md rounded-md border bg-card p-5 text-card-foreground shadow-sm">
                        <div className="flex items-start gap-3">
                          <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                          <div className="min-w-0 space-y-2">
                            <div className="font-semibold text-foreground">
                              {t('workspace.loadFailedTitle', 'Workspace load failed')}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {t(
                                'workspace.loadFailedDescription',
                                'The server is reachable, but workspace data did not load in time. This can happen after VPN reconnects or database connection resets.'
                              )}
                            </p>
                            <p className="break-words rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                              {workspaceError}
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => fetchWorkspaces(true)}
                              disabled={workspaceIsLoading}
                            >
                              <RefreshCwIcon className={workspaceIsLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                              {t('workspace.retryLoad', 'Retry')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <RefreshCwIcon className="h-4 w-4 animate-spin" />
                        <span>{t('workspace.loading', 'Loading workspace...')}</span>
                      </div>
                    )}
                  </div>
                )}
                {canShowTab('documents') && (
                  <TabsContent value="documents" className="absolute top-0 right-0 bottom-0 left-0 overflow-auto">
                    <DocumentManager />
                  </TabsContent>
                )}
                {canShowTab('chunks') && (
                  <TabsContent value="chunks" className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden">
                    <ChunkManagement />
                  </TabsContent>
                )}
                {canShowTab('knowledge-graph') && (
                  <TabsContent value="knowledge-graph" className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden">
                    <GraphViewer />
                  </TabsContent>
                )}
                {canShowTab('entity-management') && (
                  <TabsContent value="entity-management" className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden">
                    <EntityManagement />
                  </TabsContent>
                )}
                {canShowTab('schema') && (
                  <TabsContent value="schema" className="absolute top-0 right-0 bottom-0 left-0 overflow-auto">
                    <SchemaManager />
                  </TabsContent>
                )}
                {canShowTab('retrieval') && (
                  <TabsContent value="retrieval" className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden">
                    <RetrievalTesting />
                  </TabsContent>
                )}
                {canShowTab('answers') && (
                  <TabsContent value="answers" className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden">
                    <AnswerLibrary />
                  </TabsContent>
                )}
                {canShowTab('answer-sources') && (
                  <TabsContent value="answer-sources" className="absolute top-0 right-0 bottom-0 left-0 overflow-auto">
                    <AnswerSources />
                  </TabsContent>
                )}
                {canShowTab('answer-matching') && (
                  <TabsContent value="answer-matching" className="absolute top-0 right-0 bottom-0 left-0 overflow-auto">
                    <AnswerMatching />
                  </TabsContent>
                )}
                {canShowTab('structured-data') && (
                  <TabsContent value="structured-data" className="absolute top-0 right-0 bottom-0 left-0 overflow-auto">
                    <AnswerStructuredData />
                  </TabsContent>
                )}
                {canShowTab('answer-test') && (
                  <TabsContent value="answer-test" className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden">
                    <AnswerTestConsole />
                  </TabsContent>
                )}
                {canShowTab('answer-analytics') && (
                  <TabsContent value="answer-analytics" className="absolute top-0 right-0 bottom-0 left-0 overflow-auto">
                    <AnswerAnalytics />
                  </TabsContent>
                )}
                {canShowTab('answer-help') && (
                  <TabsContent value="answer-help" className="absolute top-0 right-0 bottom-0 left-0 overflow-auto">
                    <AnswerHelp />
                  </TabsContent>
                )}
                {canShowTab('api') && (
                  <TabsContent value="api" className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden">
                    <ApiSite />
                  </TabsContent>
                )}
                {canShowTab('prompts') && (
                  <TabsContent value="prompts" className="absolute top-0 right-0 bottom-0 left-0 overflow-auto">
                    <PromptSettings />
                  </TabsContent>
                )}
                {canShowTab('workspaces') && (
                  <TabsContent value="workspaces" className="absolute top-0 right-0 bottom-0 left-0 overflow-auto">
                    <WorkspaceManagement />
                  </TabsContent>
                )}
              </div>
            </Tabs>
            {enableHealthCheck && <StatusIndicator />}
            <ApiKeyAlert open={apiKeyAlertOpen} onOpenChange={handleApiKeyAlertOpenChange} />
          </main>
        )}
      </TabVisibilityProvider>
    </ThemeProvider>
  )
}

export default App
