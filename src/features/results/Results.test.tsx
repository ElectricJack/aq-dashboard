import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { resultId, resultPage, resultRecord } from "../../test/results";
const server=setupServer(...handlersFor("default"));
beforeAll(()=>server.listen({onUnhandledFrame:"error"}));afterEach(()=>server.resetHandlers());afterAll(()=>server.close());
function enabled(value=true) {server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c=>c.name!=="results.read"&&c.name!=="tasks.read"),{name:"results.read",version:"1",enabled:value,reason:"Results require Owner access"},{name:"tasks.read",version:"1",enabled:false,reason:"Not connected"}]}})));}
test("disabled results capability makes no data request",async()=>{
 enabled(false);let calls=0;server.use(http.get("/api/human/results",()=>{calls++;return HttpResponse.json(resultPage());}));renderApp("/results");await screen.findByText("Results require Owner access");expect(calls).toBe(0);
});
test("real contract feed links exact revision and renders worker text safely",async()=>{
 enabled();server.use(http.get("/api/human/results",()=>HttpResponse.json(resultPage([{...resultRecord(),conclusion:"<script>worker text</script>"}]))));renderApp("/results");
 const list=await screen.findByRole("list",{name:"Recorded results"});expect(within(list).getByText("<script>worker text</script>")).toBeInTheDocument();expect(list.querySelector("script")).toBeNull();
 expect(within(list).getByRole("link",{name:"<script>worker text</script>"})).toHaveAttribute("href",`/results/${resultId(1)}/revisions/${"a".repeat(64)}`);
 expect(list).toHaveTextContent("Worker-reported outcome: success");expect(screen.queryByRole("link",{name:resultId(101)})).toBeNull();
});
test("detail uses exact identity and project scope and preserves source base semantics",async()=>{
 enabled();server.use(http.get("/api/human/results/:id/revisions/:revision",({params,request})=>{expect(params.id).toBe(resultId(1));expect(params.revision).toBe("a".repeat(64));expect(new URL(request.url).searchParams.get("project_id")).toBe(resultId(100));return HttpResponse.json(resultPage());}));
 renderApp(`/results/${resultId(1)}/revisions/${"a".repeat(64)}?scope=project:${resultId(100)}`);
 await screen.findByRole("list",{name:"Recorded results"});expect(screen.getByText("Source base")).toBeInTheDocument();expect(screen.getByRole("link",{name:"Back to results"})).toHaveAttribute("href",`/results?scope=project%3A${resultId(100)}`);
});
test("empty coverage differs from a failed read",async()=>{
 enabled();let calls=0;server.use(http.get("/api/human/results",()=>++calls===1?HttpResponse.json({}, {status:503}):HttpResponse.json(resultPage([]))));renderApp("/results");await screen.findByRole("alert");expect(screen.queryByText("No recorded result reports in this scope.")).toBeNull();await userEvent.click(screen.getByRole("button",{name:"Try again"}));await screen.findByText("No recorded result reports in this scope.");
});
test("bounded paging advances only after explicit user request",async()=>{
 enabled();let calls=0;server.use(http.get("/api/human/results",({request})=>{calls++;const after=new URL(request.url).searchParams.get("after");return HttpResponse.json(after?resultPage([resultRecord(2)]):resultPage([resultRecord()],resultId(1)));}));renderApp("/results");await screen.findByText("Retained worker claim 1");expect(calls).toBe(1);await userEvent.click(screen.getByRole("button",{name:"Load more recorded results"}));await screen.findByText("Retained worker claim 2");expect(calls).toBe(2);
});
