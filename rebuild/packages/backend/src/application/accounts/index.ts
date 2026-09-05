export {
  AccountCoreService,
  REBUILD_SESSION_COOKIE,
  createAccountCoreService,
  type AccountServiceOptions,
  type CreateInternalAccountInput,
  type LoginInput,
  type PasswordChangeInput,
  type ProfileUpdateInput,
  type AuthenticatedAccountSession
} from "./account-service.js";
export type { AuthContext } from "../../domain/accounts/index.js";
