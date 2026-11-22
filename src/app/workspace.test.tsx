// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { CrmWorkspace } from "./auth";

afterEach(cleanup);

describe("workspace navigation", () => {
  it("opens a workspace section and marks its link active", async () => {
    render(<MemoryRouter><CrmWorkspace /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Companies" }));

    expect(await screen.findByRole("heading", { name: "Companies", level: 1 })).toBeVisible();
    expect(screen.getByRole("link", { name: "Companies" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/GP Performance/)).toHaveAttribute("aria-disabled", "true");
  });

  it("provides a dashboard link from an unknown route", () => {
    render(<MemoryRouter initialEntries={["/unknown"]}><CrmWorkspace /></MemoryRouter>);

    fireEvent.click(screen.getByRole("link", { name: "Return to dashboard" }));

    expect(screen.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  });
});
