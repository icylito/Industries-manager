import { Provider } from '@angular/core';
import { AuthGateway } from '../application/ports/auth-gateway';
import { IndustryGateway } from '../application/ports/industry-gateway';
import { ProfileGateway } from '../application/ports/profile-gateway';
import { ScratchGateway } from '../application/ports/scratch-gateway';
import { SettingsGateway } from '../application/ports/settings-gateway';
import { TablesGateway } from '../application/ports/tables-gateway';
import { TokenStore } from '../application/ports/token-store';
import { AuthApi } from './auth-api';
import { ScratchApi } from './board/scratch-api';
import { IndustryApi } from './industry-api';
import { ProfileApi } from './profile-api';
import { SettingsApi } from './settings-api';
import { TablesApi } from './tables-api';
import { BrowserTokenStore } from './token-store';

// Each port the use cases and pages ask for, answered by the class here that talks to the API or the browser.
// app.config.ts uses it for the page and src/test-providers.ts for the tests, so both are wired the same way.
export function provideInfrastructure(): Provider[] {
  return [
    { provide: IndustryGateway, useExisting: IndustryApi },
    { provide: TablesGateway, useExisting: TablesApi },
    { provide: ScratchGateway, useExisting: ScratchApi },
    { provide: AuthGateway, useExisting: AuthApi },
    { provide: ProfileGateway, useExisting: ProfileApi },
    { provide: SettingsGateway, useExisting: SettingsApi },
    { provide: TokenStore, useExisting: BrowserTokenStore },
  ];
}
