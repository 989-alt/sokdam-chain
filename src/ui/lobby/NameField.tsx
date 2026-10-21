// 이름 입력(방 만들기·방 들어가기). 12글자, 금지어는 입력 중 ● 미리보기.
import { clampName, maskedPreview, NAME_MAX } from '../shared/input';

export function NameField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const preview = maskedPreview(value);
  return (
    <div class="field">
      <label for={id} class="sr">
        내 이름
      </label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={NAME_MAX * 2}
        autocomplete="off"
        aria-describedby={`${id}-help`}
        onInput={(e) => {
          const v = clampName(e.currentTarget.value);
          e.currentTarget.value = v;
          onChange(v);
        }}
      />
      <div class="help" id={`${id}-help`}>
        <span>{NAME_MAX}글자까지 · 나쁜 말은 ●로 가려요</span>
        <span>
          {[...value].length} / {NAME_MAX}자
        </span>
      </div>
      {preview && (
        <p class="preview" role="status">
          친구들에게는 이렇게 보여요: <b>{preview}</b>
        </p>
      )}
    </div>
  );
}
