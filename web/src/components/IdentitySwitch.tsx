import type { DemoUserId } from "../types";
import { DEMO_USERS } from "../types";

export function IdentitySwitch(props: {
  userId: DemoUserId;
  disabled: boolean;
  onChange: (userId: DemoUserId) => void;
}) {
  return (
    <fieldset className="identity" disabled={props.disabled}>
      <legend>Simulated identity</legend>
      <p>This switches the stored demo session. It is not authentication.</p>
      <div className="identity-options" role="radiogroup" aria-label="Simulated identity">
        {DEMO_USERS.map((user) => (
          <label key={user.id} className={user.id === props.userId ? "identity-option selected" : "identity-option"}>
            <input
              type="radio"
              name="demo-user"
              value={user.id}
              checked={user.id === props.userId}
              onChange={() => props.onChange(user.id)}
            />
            <span className="identity-name">{user.name}</span>
            <span className="identity-role">{user.role}</span>
            <span className="identity-email">{user.email}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
