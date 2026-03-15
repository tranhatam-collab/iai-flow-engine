# IAI Flow Core Security Architecture

## Mục tiêu

Tài liệu này định nghĩa kiến trúc bảo mật lõi cho IAI Flow. Mục tiêu không chỉ là bảo vệ đăng nhập, mà là bảo vệ toàn bộ hệ vận hành: người dùng, quyền, secrets, runtime execution, audit và khả năng phản ứng khi có sự cố.

IAI Flow chỉ được xem là sẵn sàng cho người dùng thật khi 5 lớp sau được khóa chặt:

1. Identity
2. Permission
3. Secret
4. Audit
5. Runtime Guardrails

## Nguyên tắc nền

### 1. Deny by default
Mọi truy cập đều bị từ chối mặc định cho đến khi được cấp quyền rõ ràng.

### 2. Workspace-first isolation
Mọi tài nguyên nhạy cảm phải thuộc về một workspace cụ thể. Không có dữ liệu dùng chung kiểu ngầm định giữa các workspace.

### 3. Secrets never exposed in plaintext
Secrets không được hiển thị lại ở dạng đầy đủ sau khi lưu. Logs, UI và API responses không được làm lộ plaintext.

### 4. Every sensitive action must be auditable
Mọi hành động nhạy cảm phải có audit trail: ai làm, làm gì, trên tài nguyên nào, lúc nào.

### 5. Runtime must be constrained
Workflow runtime không được phép chạy vô hạn, truy cập tự do mọi thứ, hoặc tiêu tốn tài nguyên không kiểm soát.

## Kiến trúc 5 lớp

### Identity Layer
Quản lý người dùng, workspace, membership, role, session, MFA và trạng thái account.

### Permission Layer
Quy định ai được xem, sửa, publish, run, revoke, rotate, export hoặc quản trị tài nguyên.

### Secret Layer
Quản lý API keys, credentials, tokens, signing keys, encryption keys và phạm vi sử dụng của chúng.

### Audit Layer
Ghi lại mọi hành động quan trọng liên quan đến identity, permissions, secrets, workflows và admin operations.

### Runtime Guardrails Layer
Áp timeout, retry limit, rate limit, outbound policy, execution quota, memory limit, permission scope cho nodes và workflows.

## Trust Boundaries

### Boundary A — Public Edge
Phần tiếp nhận request từ internet. Tại đây phải có:
- TLS
- rate limit
- bot / abuse control
- input validation

### Boundary B — Authenticated App
Phần ứng dụng sau khi người dùng đăng nhập. Tại đây phải có:
- session validation
- workspace resolution
- permission check per action

### Boundary C — Secrets & Sensitive Data
Phần quản lý secrets và dữ liệu nhạy cảm. Tại đây phải có:
- encryption at rest
- masking
- scoped access
- audit logging

### Boundary D — Runtime Execution
Phần workflow execution. Tại đây phải có:
- execution policy
- resource quota
- network policy
- node capability checks

### Boundary E — Admin / Security Operations
Phần quản trị và phục hồi. Tại đây phải có:
- elevated permission checks
- step-up auth nếu cần
- immutable-ish audit records
- revoke / rotate / kill switch

## Core Security Decisions

### Identity decisions
- Một user có thể thuộc nhiều workspace
- Mỗi workspace có owner và nhiều admin nếu cần
- Membership là thực thể riêng
- Session gắn với user và device context

### Permission decisions
- Áp dụng RBAC làm lớp chính
- Có thể thêm resource ownership rules
- Không dùng quyền ngầm định
- Secrets, workflow publish, role change là hành động nhạy cảm

### Secret decisions
- Secrets thuộc workspace
- Secret access phải có scope
- Không trả lại plaintext secret sau khi tạo
- Secret rotation là hành động bắt buộc audit

### Audit decisions
- Log tối thiểu: actor, action, resource, workspace, timestamp
- Không log plaintext secret
- Không log payload quá nhạy cảm nếu không cần
- Log phải đủ để điều tra sự cố

### Runtime decisions
- Mọi run phải có timeout
- Mọi retry phải có giới hạn
- Mọi flow phải có execution quota
- Mọi node nhạy cảm phải có capability flag

## Tài nguyên cốt lõi

### Identity resources
- users
- workspaces
- memberships
- sessions
- mfa_settings

### Operational resources
- workflows
- workflow_versions
- workflow_runs
- workflow_run_steps
- secrets
- audit_logs

### Security resources
- role_assignments
- permission_policies
- security_events
- secret_access_events
- incident_records

## Bảo mật theo vòng đời

### Khi tạo mới
- validate đầu vào
- assign workspace
- assign owner
- create audit record

### Khi truy cập
- resolve session
- resolve workspace
- check permission
- optionally redact fields

### Khi thay đổi
- permission check
- write operation
- audit operation
- invalidate caches if needed

### Khi xóa
- soft delete nếu tài nguyên quan trọng
- enforce ownership/admin rules
- audit deletion
- apply retention policy

## Điều kiện để mở production beta

IAI Flow chỉ được mở production beta khi tối thiểu có:
- session security hoàn chỉnh
- RBAC hoàn chỉnh
- secret vault tối thiểu
- audit log nền
- runtime timeout và retry guardrails
- revoke sessions
- rotate secrets
- workspace isolation
- incident response tối thiểu
