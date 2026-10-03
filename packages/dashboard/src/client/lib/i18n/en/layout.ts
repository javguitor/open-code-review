// Shell (components/layout), generic UI components, router/error fallbacks and relative-time helpers.
const layout = {
  // Header
  'layout.breadcrumb_label': 'Breadcrumb',
  'layout.crumb_reviewers': 'Reviewers',
  'layout.crumb_maps': 'Maps',
  'layout.docs_label': 'Documentation on GitHub',
  'layout.docs_title': 'Docs',
  'layout.theme_label': 'Theme: {mode}',
  'layout.theme_cycle_label': 'Theme: {mode}. Click to cycle.',
  'layout.theme_system': 'system',
  'layout.theme_light': 'light',
  'layout.theme_dark': 'dark',
  // Sidebar connection status
  'layout.connection_label': 'Connection status: {status}',
  'layout.connection_connecting': 'Connecting',
  'layout.connection_connected': 'Connected',
  'layout.connection_reconnecting': 'Reconnecting',
  'layout.connection_disconnected': 'Disconnected',
  // Model select
  'layout.model_placeholder': 'Type model id…',
  'layout.model_custom_detail': '(custom)',
  'layout.model_custom_option': 'Custom…',
  'layout.model_custom_option_detail': 'type any model id',
  'layout.model_back_to_list': 'Back to model list',
  'layout.model_none_available': 'No models available.',
  'layout.model_source_hint': 'Model list is a bundled fallback. Use “Custom…” to enter any model id your CLI accepts.',
  'layout.model_source_hint_reason': 'Model list is a bundled fallback — {reason}. Use “Custom…” to enter any model id your CLI accepts.',
  // Phase timeline / progress bar
  'layout.phase_timeline_label': 'Phase timeline',
  'layout.phase_label': '{name}: {status}',
  'layout.phase_label_timestamp': '{name}: {status}, {timestamp}',
  'layout.phase_pending': 'pending',
  'layout.phase_active': 'active',
  'layout.phase_complete': 'complete',
  'layout.phase_skipped': 'skipped',
  'layout.progress_label': '{value} of {max} ({percent}%)',
  // Error boundary, route error fallback, 404
  'layout.error_title': 'Something went wrong',
  'layout.error_unexpected': 'An unexpected error occurred.',
  'layout.error_retry': 'Try again',
  'layout.route_error_title': 'Page Error',
  'layout.route_error_body': 'This page encountered an error. Try navigating back or refreshing.',
  'layout.route_error_back': 'Go back',
  'layout.route_error_reload': 'Reload',
  'layout.not_found': 'Page not found.',
  // Relative time (lib/date-utils.ts)
  'layout.time_just_now': 'just now',
  'layout.time_minutes_ago': '{n}m ago',
  'layout.time_hours_ago': '{n}h ago',
  'layout.time_days_ago': '{n}d ago',
}

export { layout }
