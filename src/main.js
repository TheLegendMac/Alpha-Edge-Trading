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

// Phase 3 — pure utility modules.
import './models/formatters.js';
import './models/trade.js';

// Phase 4 — constants → state → persistence.
import './config/constants.js';
import './state/store.js';
import './state/persistence.js';

// Phase 5 — sync layer. merge → supabase → auth-modal.
// supabase.js attaches the online/offline/visibility/focus event listeners
// and the 60s poll at module load time.
import './sync/merge.js';
import './sync/supabase.js';
import './sync/auth-modal.js';

// Phase 6 — market: regime, pre-trade check, IV-rank strategy, liquidity, context panel.
import './market/regime.js';
import './market/context-panel.js';

// Phase 7 — intel cards. rolling depends on trade.js (already imported).
// alpha depends on rolling, so order matters.
import './intel/glossary.js';
import './intel/rolling.js';
import './intel/alpha.js';
import './intel/clt-card.js';
import './intel/backtest.js';

// Phase 8 — views.
import './views/home.js';
import './views/log.js';
import './views/sunday.js';
import './views/reference.js';
import './views/settings.js';

// Phase 9 — modals + toast + import/export.
import './modals/toast.js';
import './modals/import-export.js';
import './modals/position-editor.js';
import './modals/trade-modal.js';

