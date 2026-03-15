# Security Implementation Checklist

## Mục tiêu

Checklist này là chuẩn tối thiểu để xác nhận IAI Flow đã có nền bảo mật đủ để mở cho người dùng thật.

## Identity
- [ ] User model hoàn chỉnh
- [ ] Workspace model hoàn chỉnh
- [ ] Membership model hoàn chỉnh
- [ ] MFA policy rõ
- [ ] User status rõ
- [ ] Session revoke hoạt động

## Permissions
- [ ] RBAC được triển khai backend
- [ ] Workflow permissions rõ
- [ ] Secret permissions rõ
- [ ] Audit access permissions rõ
- [ ] Role change được audit
- [ ] Deny by default

## Sessions
- [ ] HttpOnly Secure cookie
- [ ] session rotation sau login
- [ ] idle timeout
- [ ] absolute timeout
- [ ] logout all devices
- [ ] brute force protection

## Secrets
- [ ] encrypt at rest
- [ ] no plaintext in logs
- [ ] masked in UI
- [ ] rotation supported
- [ ] scope model defined
- [ ] secret access audit

## Audit
- [ ] login events logged
- [ ] permission changes logged
- [ ] workflow publish/run logged
- [ ] secret events logged
- [ ] admin events logged
- [ ] retention policy defined

## Runtime Guardrails
- [ ] run timeout
- [ ] step timeout
- [ ] retry limits
- [ ] quotas per workspace
- [ ] capability model per node
- [ ] kill switch

## Data Governance
- [ ] classification policy approved
- [ ] retention policy defined
- [ ] export rules defined
- [ ] restricted fields redacted

## Incident Response
- [ ] account takeover playbook
- [ ] secret leakage playbook
- [ ] runaway execution playbook
- [ ] admin compromise playbook

## Production Gate
Chỉ được mở production beta khi toàn bộ nhóm sau đều hoàn tất:
- [ ] identity
- [ ] permissions
- [ ] sessions
- [ ] secrets
- [ ] audit
- [ ] runtime guardrails
