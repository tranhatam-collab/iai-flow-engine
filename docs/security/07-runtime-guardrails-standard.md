# Runtime Guardrails Standard

## Mục tiêu

Workflow runtime là nơi dễ phát sinh lạm dụng tài nguyên, loop vô hạn, lộ secrets, gọi API ngoài ý muốn hoặc tạo chi phí vận hành lớn. Guardrails là bắt buộc.

## Guardrails tối thiểu

### Execution timeout
Mỗi workflow run phải có timeout tổng.

### Step timeout
Mỗi node hoặc step phải có timeout riêng nếu phù hợp.

### Retry limit
Mọi retry phải có giới hạn rõ ràng.

### Concurrency limit
Giới hạn số runs đồng thời theo workspace hoặc plan.

### Rate limit
Giới hạn số lần trigger / run trong đơn vị thời gian.

### Payload size limit
Chặn payload quá lớn.

### Memory / resource limit
Không cho step dùng tài nguyên không kiểm soát.

## Capability model

Mỗi node phải khai báo capability.
Ví dụ:
- needs_network
- needs_secret_access
- needs_file_access
- writes_data
- reads_sensitive_data

Runtime chỉ cho phép node dùng capability đã được policy cho phép.

## Secret use trong runtime

- runtime resolve secret tại thời điểm cần dùng
- secret không được ghi ngược vào logs
- secret access event phải được audit

## Network policy

Node outbound network phải bị kiểm soát.
Ít nhất cần:
- allowlist hoặc policy
- timeout
- retry control
- response size control

## Loop protection

- max steps per run
- max repeated branch count
- detect circular execution patterns nếu cần

## Quota model

Quotas gợi ý:
- runs/day per workspace
- concurrent runs
- max run duration
- max external requests per run
- max log lines per run

## Kill switch

Cần có:
- kill run
- disable workflow
- disable workspace execution
- disable node capability in emergency

## Điều cấm

- không cho runtime tự do internet vô hạn
- không cho run vô hạn không timeout
- không cho retry vô hạn
- không cho logs phình vô hạn
- không cho node dùng secret ngoài scope
