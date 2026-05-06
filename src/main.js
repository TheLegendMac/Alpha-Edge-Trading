// Alpha Edge Trading — module entry (Phase 2)
// Currently this module only imports CSS so Vite can bundle it.
// The application JS lives in /public/legacy.js, loaded as a regular <script>
// to preserve the original script-level globals that inline onclick= handlers depend on.
// Phases 3+ will gradually pull modules out of legacy.js and import them here.

import '../styles/tokens.css';
import '../styles/theme.css';
import '../styles/layout.css';
import '../styles/command-bar.css';
import '../styles/forms.css';
import '../styles/cards.css';
import '../styles/tables.css';
import '../styles/modals.css';
import '../styles/workflow.css';
import '../styles/panels.css';
import '../styles/utilities.css';
import '../styles/print.css';

