// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { SAMPLE_OBJECTS, SAMPLE_TARGET } from './sample';
import type { Plan, SceneObject, VisualVerification } from './types';
import { diagnosticFixture } from './test-fixtures/connection';

vi.mock('./api', () => ({ analyze: vi.fn(), health: vi.fn(), planScene: vi.fn(), verifyScene: vi.fn(), analyzeAI: vi.fn(), reasonAI: vi.fn(), connectionDiagnostics: vi.fn(), testAIConnection: vi.fn(), automaticVerify: vi.fn(), replanScene: vi.fn(), verifyReviewed: vi.fn() }));
import { analyze, analyzeAI, automaticVerify, connectionDiagnostics, health, planScene, reasonAI, replanScene, verifyScene } from './api';

const plannedObjects: SceneObject[] = SAMPLE_OBJECTS.map(obj => ({ ...obj, box: obj.id === 'notebook' ? { ...obj.box, x: .132, y: .362 } : obj.id === 'headphones' ? { ...obj.box, x: .708, y: .474 } : obj.box }));
const result: Plan = { status: 'ready', message: 'A collision-free layout is ready in 2 movements.', final_objects: plannedObjects, locked_ids: ['coffee', 'plant', 'keyboard'], explored_states: 2, warnings: [], movements: [{ number: 1, object_id: 'notebook', label: 'Notebook', source: SAMPLE_OBJECTS[0].box, destination: plannedObjects[0].box, instruction: 'Lift Notebook into the numbered box.' }] };

function autoResult(passed: boolean): VisualVerification {
  return {passed,status:passed ? 'passed' : 'needs_review',review_required:!passed,message:passed ? 'Detected placements match.' : 'Identity needs review.',matched_count:passed ? 6 : 0,
    objects:plannedObjects.map(o=>({object_id:o.id,label:o.label,detection_id:`d-${o.id}`,candidate_ids:[`d-${o.id}`],certainty:passed ? 'supported' : 'uncertain',provider_confidence:passed ? .9 : null,appearance_similarity:null,reasons:passed ? [] : ['Identity uncertain'],status:passed ? 'completed' : 'uncertain',matched:passed,edge_error:0,tolerance:.025,protected:o.locked})),
    steps:[{number:1,object_id:'notebook',status:passed ? 'completed' : 'uncertain'}],issues:[],unexpected_movements:[],uncertain_ids:passed ? [] : ['notebook'],detections:plannedObjects.map(o=>({...o,id:`d-${o.id}`})),observed_objects:structuredClone(plannedObjects),latency_ms:1000,confidence:passed ? 'supported' : 'uncertain'};
}

beforeEach(() => {
  vi.mocked(connectionDiagnostics).mockResolvedValue(diagnosticFixture());
  vi.mocked(health).mockResolvedValue({ status: 'ok' });
  vi.mocked(planScene).mockResolvedValue(structuredClone(result));
  vi.mocked(analyze).mockResolvedValue({ image_url: 'data:image/jpeg;base64,fixture', width: 1200, height: 800, name: 'after.png', annotation_source: 'manual', message: 'Validated' });
  vi.mocked(verifyScene).mockResolvedValue({ passed: true, message: 'Final annotations match.', matched_count: 6, issues: [], objects: SAMPLE_OBJECTS.map(obj => ({ object_id: obj.id, label: obj.label, matched: true, edge_error: 0, tolerance: .025 })) });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function makePlan() {
  fireEvent.click(screen.getByRole('button', { name: 'Generate spatial plan' }));
  await screen.findByText('Room for your next idea');
}
async function openFinal() {
  await makePlan();
  fireEvent.click(screen.getByRole('button', { name: 'I’ve made the moves' }));
  fireEvent.change(screen.getByLabelText('Upload final image'), { target: { files: [new File(['fixture'], 'after.png', { type: 'image/png' })] } });
  await screen.findByLabelText('Confirm final Notebook position');
}

describe('WorldOS workflow', () => {
  it('keeps the demo opt-in and animates the actual generated movement', async () => {
    render(<App/>);
    expect(screen.queryByLabelText('WorldOS Demo Mode')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Demo Mode'}));
    fireEvent.click(screen.getByRole('button',{name:'Begin walkthrough'}));
    expect(analyzeAI).not.toHaveBeenCalled();
    expect(automaticVerify).not.toHaveBeenCalled();
    await makePlan();
    fireEvent.click(screen.getByRole('button',{name:'4Guide'}));
    expect(screen.getByText('Movement 1 of 1: Notebook')).toBeTruthy();
    expect(document.querySelector('animateMotion')?.getAttribute('repeatCount')).toBe('indefinite');
    expect(screen.queryByText('Task verified')).toBeNull();
  });
  it('shows an automatic demo success only until its evidence is edited', async () => {
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'Demo Mode'}));
    fireEvent.click(screen.getByRole('button',{name:'Begin walkthrough'}));
    await openFinal();
    fireEvent.click(screen.getByLabelText('Same camera framing confirmed'));
    fireEvent.click(screen.getByLabelText('Complete current obstacle inventory confirmed'));
    vi.mocked(automaticVerify).mockResolvedValueOnce(autoResult(true));
    fireEvent.click(screen.getByRole('button',{name:'Automatic Verify'}));
    await screen.findByText('Task verified');
    expect(screen.getByText(/Automatic SAM evidence with scene confirmations/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Final x percent'),{target:{value:'20'}});
    expect(screen.queryByText('Task verified')).toBeNull();
  });
  it('clears successful automatic verification when an observed position changes', async () => {
    render(<App/>);
    await openFinal();
    fireEvent.click(screen.getByLabelText('Same camera framing confirmed'));
    fireEvent.click(screen.getByLabelText('Complete current obstacle inventory confirmed'));
    vi.mocked(automaticVerify).mockResolvedValueOnce(autoResult(true));
    fireEvent.click(screen.getByRole('button',{name:'Automatic Verify'}));
    await screen.findByText('Space, successfully made.');
    expect((screen.getByLabelText('Movement completion') as HTMLProgressElement).value).toBe(1);
    fireEvent.change(screen.getByLabelText('Final x percent'),{target:{value:'20'}});
    expect(screen.queryByText('Space, successfully made.')).toBeNull();
    expect(screen.getByText(/scan results are historical/)).toBeTruthy();
    expect((screen.getByLabelText('Complete current obstacle inventory confirmed') as HTMLInputElement).checked).toBe(false);
  });
  it('never displays uncertain automatic matches as verified success', async () => {
    render(<App/>);
    await openFinal();
    vi.mocked(automaticVerify).mockResolvedValueOnce(autoResult(false));
    fireEvent.click(screen.getByRole('button',{name:'Automatic Verify'}));
    await screen.findByText('Identity needs review.');
    expect(screen.queryByText('Space, successfully made.')).toBeNull();
    expect((screen.getByRole('button',{name:'Replan from Current State'}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Confirm final Notebook position') as HTMLInputElement).checked).toBe(false);
  });
  it('keeps automatic verification opt-in and preserves manual fallback on provider failure', async () => {
    render(<App/>);
    await openFinal();
    expect(automaticVerify).not.toHaveBeenCalled();
    vi.mocked(automaticVerify).mockRejectedValueOnce(new Error('Provider rate limited. Retry explicitly.'));
    fireEvent.click(screen.getByRole('button', { name: 'Automatic Verify' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('rate limited'));
    expect(automaticVerify).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Confirm final Notebook position')).toBeTruthy();
    expect(screen.queryByText('Space, successfully made.')).toBeNull();
  });
  it('replans only from fully reviewed state and retains the original goal', async () => {
    render(<App/>);
    await openFinal();
    const replan = screen.getByRole('button', { name: 'Replan from Current State' }) as HTMLButtonElement;
    expect(replan.disabled).toBe(true);
    for (const obj of SAMPLE_OBJECTS) fireEvent.click(screen.getByLabelText(`Confirm final ${obj.label} position`));
    fireEvent.click(screen.getByLabelText('Same camera framing confirmed'));
    fireEvent.click(screen.getByLabelText('Complete current obstacle inventory confirmed'));
    expect(replan.disabled).toBe(false);
    vi.mocked(replanScene).mockResolvedValueOnce({ status: 'ready', reasons: ['Notebook placement incomplete.'], original_plan: structuredClone(result), revised_plan: structuredClone(result), plan_request: { objects: structuredClone(SAMPLE_OBJECTS), target: SAMPLE_TARGET, workspace: {x:0,y:0,width:1,height:1}, goal: 'Make room for my laptop without moving my coffee.', clearance: .008 } });
    fireEvent.click(replan);
    await screen.findByText('Original plan versus revised plan');
    expect(replanScene).toHaveBeenCalledWith(expect.objectContaining({ original_request: expect.objectContaining({goal:'Make room for my laptop without moving my coffee.'}), reviewed_ids: expect.arrayContaining(['notebook','coffee']) }));
    expect(screen.getByText('Notebook placement incomplete.')).toBeTruthy();
  });
  it('requires scene review for actual AI boxes and clears confidence after correction', async () => {
    vi.mocked(analyzeAI).mockResolvedValueOnce({ objects: [{ ...SAMPLE_OBJECTS[0], source: 'sam_3_1', confidence: .875 }], concepts: ['notebook'], summary: 'Notebook', message: 'Review', warnings: [], provider: 'meta', model: 'sam-3.1' });
    render(<App/>);
    fireEvent.change(screen.getByLabelText('Upload scene image'), { target: { files: [new File(['fixture'], 'desk.png', { type: 'image/png' })] } });
    await screen.findByText('Every object starts with a box.');
    fireEvent.click(screen.getByRole('button', { name: 'AI Analysis' }));
    await screen.findByText('SAM 3.1 · 87.5%');
    const review = screen.getByLabelText('I reviewed all AI annotations and added missed obstacles') as HTMLInputElement;
    expect(review.checked).toBe(false);
    fireEvent.click(review);
    fireEvent.change(screen.getByLabelText('Object label'), { target: { value: 'Journal' } });
    expect(screen.getByText('User corrected · confidence cleared')).toBeTruthy();
    expect(review.checked).toBe(false);
  });
  it('passes reviewed Muse constraints into the planner and invalidates them after goal edits', async () => {
    const constraints = { protected_object_ids: ['coffee'], summary: 'Leave the drink fixed.', unsupported_requirements: [], needs_clarification: false };
    vi.mocked(reasonAI).mockResolvedValueOnce({ constraints, model: 'muse-spark-1.3', provider: 'meta', confidence: null, message: 'Review' });
    render(<App/>);
    fireEvent.click(screen.getByRole('button', { name: 'Interpret goal with Muse Spark' }));
    await screen.findByText('Leave the drink fixed.');
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed constraints' }));
    await makePlan();
    expect(vi.mocked(planScene).mock.calls[0][0].constraints).toEqual(constraints);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust scene & goal' }));
    fireEvent.change(screen.getByLabelText('Your spatial goal'), { target: { value: 'Clear the area.' } });
    expect(screen.queryByText('Reviewed constraints applied')).toBeNull();
  });
  it('submits real scene state and goal, then shows returned movements', async () => {
    render(<App/>);
    await makePlan();
    expect(planScene).toHaveBeenCalledWith(expect.objectContaining({ objects: SAMPLE_OBJECTS, target: SAMPLE_TARGET, clearance: .008 }));
    expect(screen.getByText('Lift Notebook into the numbered box.')).toBeTruthy();
    expect(screen.getByLabelText('Your spatial goal').hasAttribute('disabled')).toBe(true);
  });
  it('persists label and lock edits in the planning request', async () => {
    render(<App/>);
    fireEvent.change(screen.getByLabelText('Object label'), { target: { value: 'Journal' } });
    fireEvent.click(screen.getByLabelText('Lock Journal'));
    await makePlan();
    const submitted = vi.mocked(planScene).mock.calls[0][0];
    expect(submitted.objects[0]).toMatchObject({ label: 'Journal', locked: true });
  });
  it('displays backend errors and allows retry', async () => {
    vi.mocked(planScene).mockRejectedValueOnce(new Error('Annotations overlap: Notebook and Coffee.'));
    render(<App/>);
    fireEvent.click(screen.getByRole('button', { name: 'Generate spatial plan' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Annotations overlap: Notebook and Coffee.');
    await makePlan();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('clears old scene annotations when uploading a new photo', async () => {
    render(<App/>);
    fireEvent.change(screen.getByLabelText('Upload scene image'), { target: { files: [new File(['fixture'], 'desk.png', { type: 'image/png' })] } });
    await screen.findByText('Every object starts with a box.');
    expect(screen.queryByLabelText('Lock Notebook')).toBeNull();
    expect((screen.getByRole('button', { name: 'Generate spatial plan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Where should we make room?')).toBeTruthy();
  });
  it('starts observations at original positions and requires individual confirmations', async () => {
    render(<App/>);
    await openFinal();
    expect((screen.getByLabelText('Final x percent') as HTMLInputElement).value).toBe('39');
    const verify = screen.getByRole('button', { name: 'Verify placements' }) as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
    for (const obj of SAMPLE_OBJECTS) fireEvent.click(screen.getByLabelText(`Confirm final ${obj.label} position`));
    expect(verify.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Final x percent'), { target: { value: '13.2' } });
    expect((screen.getByLabelText('Confirm final Notebook position') as HTMLInputElement).checked).toBe(false);
    expect(verify.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Confirm final Notebook position'));
    fireEvent.click(verify);
    await screen.findByText('Space, successfully made.');
    expect(verifyScene).toHaveBeenCalledWith(expect.objectContaining({ target: SAMPLE_TARGET }), expect.arrayContaining([expect.objectContaining({ id: 'notebook', box: expect.objectContaining({ x: .132 }) })]));
    fireEvent.change(screen.getByLabelText('Final y percent'), { target: { value: '20' } });
    expect(screen.queryByText('Space, successfully made.')).toBeNull();
  });
  it('rejects final photos with incompatible aspect ratios', async () => {
    render(<App/>);
    await makePlan();
    fireEvent.click(screen.getByRole('button', { name: 'I’ve made the moves' }));
    vi.mocked(analyze).mockResolvedValueOnce({ image_url: 'fixture', width: 800, height: 1200, name: 'wrong.png', annotation_source: 'manual', message: 'Validated' });
    fireEvent.change(screen.getByLabelText('Upload final image'), { target: { files: [new File(['fixture'], 'wrong.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('same aspect ratio'));
    expect(screen.queryByLabelText('Confirm final Notebook position')).toBeNull();
  });
});
