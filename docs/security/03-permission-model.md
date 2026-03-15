# Permission Model

## Mục tiêu

Permission model đảm bảo mọi hành động trong IAI Flow đều được kiểm soát rõ ràng theo nguyên tắc deny by default.

## Phương pháp

IAI Flow dùng RBAC làm nền:
- owner
- admin
- builder
- operator
- analyst
- viewer

Ngoài RBAC, một số hành động cần ownership hoặc scope checks.

## Tài nguyên cần kiểm soát

- workspace
- membership
- workflow
- workflow_version
- workflow_run
- secret
- logs
- metrics
- settings
- audit_logs
- exports

## Hành động chuẩn

- read
- create
- update
- delete
- publish
- run
- cancel
- rotate
- invite
- manage_roles
- export
- view_sensitive

## Ma trận quyền nền

### owner
Toàn quyền trong workspace.

### admin
Gần toàn quyền, trừ một số hành động chiến lược nếu muốn giới hạn:
- transfer ownership
- remove final owner

### builder
- create workflow
- update workflow
- publish workflow nếu được cấp
- không mặc định xem secrets plaintext
- không mặc định đổi roles

### operator
- run workflow
- cancel run
- view logs
- view metrics
- không sửa cấu trúc workflow nếu không được cấp

### analyst
- view workflows
- view metrics
- view selected logs
- export non-sensitive reports

### viewer
- read-only, không thao tác vận hành

## Quy tắc nhạy cảm

Các hành động sau luôn cần elevated checks:
- manage_roles
- rotate_secret
- delete_secret
- export_sensitive
- view_audit_logs
- revoke_sessions
- workspace_security_settings

## Ownership rules

Một số resource có creator hoặc owner nội bộ, nhưng không được dùng ownership để bỏ qua role check. Ownership chỉ là lớp phụ trợ.

Ví dụ:
- Người tạo workflow có thể sửa bản nháp của mình
- Nhưng publish lên production vẫn có thể cần builder+ hoặc admin

## Secret permissions

Permission phải tách riêng:
- secret.create
- secret.update_metadata
- secret.rotate
- secret.delete
- secret.use
- secret.view_metadata

Không có quyền nào cho secret.read_plaintext sau khi lưu.

## Workflow permissions

Tách rõ:
- workflow.create
- workflow.update_draft
- workflow.publish
- workflow.run
- workflow.cancel
- workflow.view_logs
- workflow.export

## Audit permissions

Audit log không phải ai cũng xem được.
Tối thiểu:
- owner/admin: xem đầy đủ hơn
- operator: xem logs vận hành giới hạn
- viewer: không xem audit nhạy cảm

## Permission evaluation order

1. resolve session
2. resolve workspace
3. resolve membership
4. check role policy
5. check resource scope
6. check feature flags nếu có
7. allow hoặc deny

## Không được làm

- không hardcode quyền trong UI rồi bỏ kiểm tra ở backend
- không tin role từ client payload
- không cho phép fallback mơ hồ kiểu “admin-ish”
- không dùng email domain làm quyền thực sự

## Output policy

Khi deny:
- trả mã lỗi chuẩn
- không lộ thông tin nhạy cảm
- có thể audit deny events với severity phù hợp
