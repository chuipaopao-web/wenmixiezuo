import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { ExpressionProfileRepository, type ExpressionProfileRecord } from '../../infrastructure/db/repositories/expression-profile-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export class ExpressionProfileService {
  public constructor(
    private readonly profiles: ExpressionProfileRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public revise(scope: BookScope, input: {
    narrativePerson?: 'first' | 'third' | 'mixed' | null;
    viewpointDistance?: 'close' | 'medium' | 'distant' | 'adaptive' | null;
    languageTone?: string[];
    textDensity?: 'light' | 'balanced' | 'dense' | 'adaptive' | null;
    targetAudience?: string | null;
    contentBoundaries?: Record<string, unknown>;
    humorSeriousness?: 'humorous' | 'balanced' | 'serious' | 'adaptive' | null;
    voiceEvidence?: unknown[];
    impactScope?: Record<string, unknown>;
    confirm: boolean;
  }): ExpressionProfileRecord {
    const now = this.clock.now().toISOString();
    return this.unitOfWork.run(() => {
      const previous = this.profiles.active(scope);
      this.profiles.supersedeActive(scope, now);
      return this.profiles.create(scope, {
        profileId: this.ids.next(),
        version: this.profiles.nextVersion(scope),
        narrativePerson: input.narrativePerson ?? previous?.narrativePerson ?? null,
        viewpointDistance: input.viewpointDistance ?? previous?.viewpointDistance ?? null,
        languageToneJson: JSON.stringify(input.languageTone ?? previous?.languageTone ?? []),
        textDensity: input.textDensity ?? previous?.textDensity ?? null,
        targetAudience: input.targetAudience ?? previous?.targetAudience ?? null,
        contentBoundariesJson: JSON.stringify(input.contentBoundaries ?? previous?.contentBoundaries ?? {}),
        humorSeriousness: input.humorSeriousness ?? previous?.humorSeriousness ?? null,
        voiceEvidenceJson: JSON.stringify(input.voiceEvidence ?? previous?.voiceEvidence ?? []),
        impactScopeJson: JSON.stringify(input.impactScope ?? { appliesFrom: 'next_formal_work_order' }),
        status: input.confirm ? 'confirmed' : 'provisional',
        now
      });
    });
  }

  public active(scope: BookScope): ExpressionProfileRecord | null {
    return this.profiles.active(scope);
  }
}
