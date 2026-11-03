import {screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {setupServer} from 'msw/node';
import {handlersFor} from '../../mocks/handlers';
import {renderApp} from '../../test/renderApp';
const server=setupServer(...handlersFor('default'));
beforeAll(()=>server.listen({onUnhandledFrame:'error'}));afterEach(()=>server.resetHandlers());afterAll(()=>server.close());
test('pins only an explicitly selected session and opens the exact session',async()=>{
 renderApp('/overview');const panel=await screen.findByRole('region',{name:'Pinned sessions'});
 expect(await within(panel).findByText(/No pinned sessions/)).toBeVisible();
 await userEvent.click(within(panel).getByText('Choose sessions'));
 const select=await within(panel).findByRole('combobox',{name:'Session snapshot'});
 const options=within(select).getAllByRole('option');const choice=options[1] as HTMLOptionElement;
 await userEvent.selectOptions(select,choice.value);await userEvent.click(within(panel).getByRole('button',{name:'Pin session'}));
 expect(within(panel).queryByText(/No pinned sessions/)).toBeNull();
 const link=within(panel).getByRole('link',{name:/^(Open|Watch):/});expect(link).toHaveAttribute('href',`/agents/${encodeURIComponent(choice.value)}`);
 expect(panel).toHaveTextContent('Pins last for this visit');
 await userEvent.click(within(panel).getByRole('button',{name:/Unpin /}));expect(within(panel).getByText(/No pinned sessions/)).toBeVisible();
});
