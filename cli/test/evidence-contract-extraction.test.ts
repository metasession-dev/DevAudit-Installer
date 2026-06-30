import { describe, it, expect } from 'vitest';
import { extractEvidenceTypesFromContent } from '../src/lib/evidence-type-extractor.js';

/**
 * Unit tests for the evidence-type extractor — verifies the regex
 * patterns correctly parse the three extraction shapes used in CI
 * templates:
 * 1. upload-evidence.sh positional args
 * 2. EVTYPE= assignments
 * 3. upload_project_doc calls
 */
describe('evidence-type extractor — devaudit-installer#247', () => {
  it('extracts types from upload-evidence.sh positional args', () => {
    const content = `
          bash scripts/upload-evidence.sh \\
            \${{PROJECT_SLUG}} _compliance-docs sast_report ci-evidence/sast-results.json \\
            --category security_scan
          bash scripts/upload-evidence.sh \\
            \${{PROJECT_SLUG}} _compliance-docs e2e_result ci-evidence/e2e-results.json \\
            --category e2e_result
    `;
    const types = extractEvidenceTypesFromContent(content);
    expect(types.has('sast_report')).toBe(true);
    expect(types.has('e2e_result')).toBe(true);
    expect(types.size).toBe(2);
  });

  it('extracts types from EVTYPE= assignments', () => {
    const content = `
                  test-execution-summary.md|test-summary-report.md)
                    EVTYPE=test_report; EVCAT=test_report ;;
                  srs-alignment.md)
                    EVTYPE=srs_alignment; EVCAT=planning ;;
                  architecture-decision.md)
                    EVTYPE=architecture_decision; EVCAT=planning ;;
    `;
    const types = extractEvidenceTypesFromContent(content);
    expect(types.has('test_report')).toBe(true);
    expect(types.has('srs_alignment')).toBe(true);
    expect(types.has('architecture_decision')).toBe(true);
  });

  it('extracts types from upload_project_doc calls', () => {
    const content = `
          upload_project_doc compliance/RTM.md         rtm
          upload_project_doc compliance/test-plan.md   test_plan
          upload_project_doc compliance/test-cases.md  test_cases
    `;
    const types = extractEvidenceTypesFromContent(content);
    expect(types.has('rtm')).toBe(true);
    expect(types.has('test_plan')).toBe(true);
    expect(types.has('test_cases')).toBe(true);
  });

  it('deduplicates across patterns', () => {
    const content = `
          bash scripts/upload-evidence.sh \\
            \${{PROJECT_SLUG}} _compliance-docs test_report compliance/test.md
          EVTYPE=test_report; EVCAT=test_report ;;
    `;
    const types = extractEvidenceTypesFromContent(content);
    expect(types.has('test_report')).toBe(true);
    expect(types.size).toBe(1);
  });

  it('returns empty set for content with no evidence types', () => {
    const content = `
          chmod +x scripts/upload-evidence.sh 2>/dev/null || true
          echo "No evidence to upload"
    `;
    const types = extractEvidenceTypesFromContent(content);
    expect(types.size).toBe(0);
  });

  it('extracts all known types from a realistic template snippet', () => {
    const content = `
          bash scripts/upload-evidence.sh \\
            \${{PROJECT_SLUG}} _compliance-docs sast_report ci-evidence/sast-results.json \\
            --category security_scan --gate-status "\$STATUS_SAST" \${FLAGS}

          bash scripts/upload-evidence.sh \\
            \${{PROJECT_SLUG}} _compliance-docs dependency_audit ci-evidence/dependency-audit.json \\
            --category security_scan --gate-status "\$STATUS_DEPAUDIT" \${FLAGS}

          bash scripts/upload-evidence.sh \\
            \${{PROJECT_SLUG}} _compliance-docs e2e_result ci-evidence/e2e-results.json \\
            --category e2e_result \${FLAGS}

          bash scripts/upload-evidence.sh \\
            \${{PROJECT_SLUG}} _compliance-docs e2e_report ci-evidence/playwright-report.zip \\
            --category e2e_report \${FLAGS}

          bash scripts/upload-evidence.sh \\
            \${{PROJECT_SLUG}} _compliance-docs coverage_report ci-evidence/coverage/coverage-summary.json \\
            --category coverage_report \${FLAGS}

          bash scripts/upload-evidence.sh \\
            \${{PROJECT_SLUG}} _compliance-docs gate_outcome ci-evidence/gate-outcomes.json \\
            --category ci_pipeline \${FLAGS}
    `;
    const types = extractEvidenceTypesFromContent(content);
    expect(types.has('sast_report')).toBe(true);
    expect(types.has('dependency_audit')).toBe(true);
    expect(types.has('e2e_result')).toBe(true);
    expect(types.has('e2e_report')).toBe(true);
    expect(types.has('coverage_report')).toBe(true);
    expect(types.has('gate_outcome')).toBe(true);
  });
});
