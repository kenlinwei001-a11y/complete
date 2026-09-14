import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

describe("PlanBuilderPage", () => {
  it("renders canvas list and initial canvas", async () => {
    loginAs("planner");
    renderApp("/admin/plan-builder");

    await waitFor(() => expect(screen.getByTestId("plan-builder-page")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("pb-canvas-pbc_demo_1")).toBeInTheDocument());
    expect(screen.getByTestId("pb-canvas-list")).toBeInTheDocument();
    expect(screen.getByTestId("pb-canvas-svg")).toBeInTheDocument();
    expect(screen.getByTestId("pb-node-n1")).toBeInTheDocument();
    expect(screen.getByTestId("pb-node-n2")).toBeInTheDocument();
  });

  it("shows solverKey control when selecting a SOLVER node", async () => {
    loginAs("planner");
    renderApp("/admin/plan-builder");

    await waitFor(() => expect(screen.getByTestId("pb-node-n2")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pb-node-n2"));

    await waitFor(() => {
      expect(screen.getByTestId("pb-solver-select-n2")).toBeInTheDocument();
    });
  });

  it("DSL tab shows equivalent JSON for the canvas", async () => {
    loginAs("planner");
    renderApp("/admin/plan-builder");

    await waitFor(() => expect(screen.getByTestId("pb-canvas-pbc_demo_1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pb-canvas-pbc_demo_1"));
    await waitFor(() => expect(screen.getByTestId("pb-tab-dsl")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pb-tab-dsl"));

    const textarea = await screen.findByTestId("pb-dsl-textarea");
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect((textarea as HTMLTextAreaElement).value).toContain('"version": "1"');
    expect((textarea as HTMLTextAreaElement).value).toContain('"capacity_forecast"');
  });
});
