import type { AybAuth, AybUser } from "./auth";
import { DEMO_ACCOUNTS } from "./config";
import { createTextElement } from "./dom";

export const renderUserChip = (auth: AybAuth, user: AybUser): void => {
  const topbarRight = document.querySelector<HTMLElement>(".ayb-topbar-right");
  if (!topbarRight) return;
  const chip = document.createElement("div");
  chip.className = "ayb-user-chip";
  chip.append(
    createTextElement("span", "ayb-user-chip-dot", ""),
    createTextElement("span", "ayb-user-chip-email", user.email),
  );
  const signOut = createTextElement("button", "ayb-signout-btn", "Sign out") as HTMLButtonElement;
  signOut.type = "button";
  signOut.addEventListener("click", () => {
    void auth.signOut().finally(() => window.location.reload());
  });
  topbarRight.prepend(chip, signOut);
};

export const renderSignInCard = (
  mount: HTMLElement,
  auth: AybAuth,
  onSignedIn: (user: AybUser) => void,
): void => {
  const card = document.createElement("section");
  card.className = "ayb-signin";

  card.append(
    createTextElement("h2", "", "Sign in to your workspace"),
    createTextElement(
      "p",
      "ayb-signin-copy",
      "Each account sees only the sites it is entitled to. InsForge verifies your login and enforces row-level access for SQL. Runtype verifies a short-lived identity proof before running the analyst as you.",
    ),
  );

  const form = document.createElement("form");
  form.className = "ayb-signin-form";
  const email = document.createElement("input");
  email.type = "email";
  email.required = true;
  email.placeholder = "Email";
  email.autocomplete = "username";
  email.setAttribute("aria-label", "Email");
  const password = document.createElement("input");
  password.type = "password";
  password.required = true;
  password.placeholder = "Password";
  password.autocomplete = "current-password";
  password.setAttribute("aria-label", "Password");
  const submit = createTextElement("button", "ayb-signin-submit", "Sign in") as HTMLButtonElement;
  submit.type = "submit";
  const errorLine = createTextElement("p", "ayb-signin-error", "");
  form.append(email, password, submit, errorLine);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    errorLine.textContent = "";
    submit.disabled = true;
    submit.textContent = "Signing in…";
    void auth
      .signIn(email.value.trim(), password.value)
      .then((user) => {
        card.remove();
        onSignedIn(user);
      })
      .catch((error: Error) => {
        errorLine.textContent = error.message;
        submit.disabled = false;
        submit.textContent = "Sign in";
      });
  });
  card.appendChild(form);

  if (DEMO_ACCOUNTS.length > 0) {
    const demo = document.createElement("div");
    demo.className = "ayb-signin-demo";
    demo.appendChild(createTextElement("span", "", "Demo accounts:"));
    for (const account of DEMO_ACCOUNTS) {
      const button = createTextElement(
        "button",
        "ayb-signin-demo-btn",
        account.label ?? account.email,
      ) as HTMLButtonElement;
      button.type = "button";
      button.addEventListener("click", () => {
        email.value = account.email;
        password.value = account.password;
        form.requestSubmit();
      });
      demo.appendChild(button);
    }
    card.appendChild(demo);
  }

  mount.appendChild(card);
};
