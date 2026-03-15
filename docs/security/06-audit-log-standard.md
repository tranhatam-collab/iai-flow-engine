# Audit Log Standard

## Mục tiêu

Audit log cho phép truy vết những gì đã xảy ra trong hệ thống và hỗ trợ điều tra sự cố, tranh chấp, sai sót vận hành.

## Mọi hành động nào phải được audit

### Identity events
- login success
- login failure
- logout
- logout all sessions
- MFA enabled/disabled
- password reset nếu có

### Permission events
- role changed
- member invited
- member removed
- owner transferred

### Secret events
- secret created
- secret rotated
- secret deleted
- secret metadata viewed
- secret used by runtime

### Workflow events
- workflow created
- workflow updated
- workflow published
- workflow run started
- workflow run canceled
- workflow run failed critically

### Admin events
- workspace settings changed
- security settings changed
- suspicious account action handled

## Schema tối thiểu

- event_id
- actor_id
- workspace_id
- event_type
- resource_type
- resource_id
- severity
- created_at
- metadata_json
- ip_hash
- user_agent_hash

## Severity gợi ý

- info
- warning
- critical

## Metadata policy

Metadata phải đủ dùng nhưng không được làm lộ dữ liệu nhạy cảm.
Ví dụ được phép:
- old_role, new_role
- secret_id
- workflow_id
- run_id

Ví dụ không được:
- plaintext secret
- full sensitive payload nếu không cần

## Retention

Audit logs phải có retention policy rõ.
Không được xóa tùy tiện như application logs thông thường.

## Access control

- owner/admin được xem phạm vi rộng hơn
- operator có thể xem một phần
- viewer không được xem audit nhạy cảm

## Integrity

Audit logs cần được bảo vệ khỏi sửa đổi tùy tiện.
Ít nhất phải:
- append-oriented
- hạn chế update/delete
- log mọi hành động xóa nếu có retention cleanup job
