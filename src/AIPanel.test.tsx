// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIPanel from './AIPanel';
import { SAMPLE_IMAGE, SAMPLE_OBJECTS, SAMPLE_TARGET } from './sample';
import type { PlanningConstraints } from './types';
import { diagnosticFixture } from './test-fixtures/connection';

vi.mock('./api', () => ({ analyzeAI: vi.fn(), reasonAI: vi.fn(), connectionDiagnostics: vi.fn(), testAIConnection: vi.fn() }));
import { analyzeAI, connectionDiagnostics, reasonAI } from './api';

const constraints: PlanningConstraints = { protected_object_ids: ['coffee'], summary: 'Keep the drink where it is.', unsupported_requirements: [], needs_clarification: false };
const onAnnotations = vi.fn(), onConstraints = vi.fn(), onError = vi.fn(), onBusy = vi.fn();
const props = { image: { ...SAMPLE_IMAGE, image_url: 'data:image/jpeg;base64,fixture' }, isSample: false, objects: SAMPLE_OBJECTS, target: SAMPLE_TARGET, goal: 'Leave my drink alone', busy: null, constraints: null, onAnnotations, onConstraints, onError, onBusy };

beforeEach(() => {
  vi.mocked(connectionDiagnostics).mockResolvedValue(diagnosticFixture());
  vi.mocked(analyzeAI).mockResolvedValue({ objects: [{ ...SAMPLE_OBJECTS[0], source: 'sam_3_1', confidence: .91 }], concepts: ['notebook'], summary: 'An obstacle', message: 'One object returned.', warnings: ['Review the scene.'], provider: 'meta', model: 'sam-3.1' });
  vi.mocked(reasonAI).mockResolvedValue({ constraints, provider: 'meta', model: 'muse-spark-1.3', confidence: null, message: 'Review first.' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('explicit AI assistance', () => {
  it('never sends a photo just by rendering and disables segmentation on the illustration', () => {
    render(<AIPanel {...props} isSample={true}/>);
    expect(analyzeAI).not.toHaveBeenCalled();
    expect(reasonAI).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'AI Analysis' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('requires explicit replacement and splits concepts into separate phrases', async () => {
    render(<AIPanel {...props}/>);
    const button = screen.getByRole('button', { name: 'AI Analysis' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Replace existing annotations with AI results'));
    fireEvent.change(screen.getByLabelText('SAM object concepts'), { target: { value: 'notebook, coffee cup' } });
    fireEvent.click(button);
    await waitFor(() => expect(onAnnotations).toHaveBeenCalled());
    expect(analyzeAI).toHaveBeenCalledWith(props.image.image_url, ['notebook', 'coffee cup']);
    expect(screen.getByRole('status').textContent).toContain('One object returned.');
  });
  it('uses concept discovery when the concepts field is empty', async () => {
    render(<AIPanel {...props} objects={[]}/>);
    fireEvent.click(screen.getByRole('button', { name: 'AI Analysis' }));
    await waitFor(() => expect(analyzeAI).toHaveBeenCalledWith(props.image.image_url, []));
  });
  it('does not replace annotations or simulate detection when a provider fails', async () => {
    vi.mocked(analyzeAI).mockRejectedValueOnce(new Error('MODEL_API_KEY is not configured.'));
    render(<AIPanel {...props} objects={[]}/>);
    fireEvent.click(screen.getByRole('button', { name: 'AI Analysis' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('MODEL_API_KEY is not configured.'));
    expect(onAnnotations).not.toHaveBeenCalled();
    expect(onBusy).toHaveBeenLastCalledWith(null);
  });
  it('shows reasoning for user review before applying protected IDs', async () => {
    render(<AIPanel {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Interpret goal with Muse Spark' }));
    await screen.findByText('Keep the drink where it is.');
    expect(onConstraints).not.toHaveBeenCalled();
    expect(reasonAI).toHaveBeenCalledWith(props.objects, props.goal, props.target, props.image.image_url);
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed constraints' }));
    expect(onConstraints).toHaveBeenCalledWith(constraints);
  });
  it('prevents applying unsupported requirements', async () => {
    vi.mocked(reasonAI).mockResolvedValueOnce({ constraints: { ...constraints, unsupported_requirements: ['Stack books vertically'] }, provider: 'meta', model: 'muse-spark-1.3', confidence: null, message: 'Unsupported' });
    render(<AIPanel {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Interpret goal with Muse Spark' }));
    await screen.findByText('Unsupported: Stack books vertically');
    expect((screen.getByRole('button', { name: 'Apply reviewed constraints' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onConstraints).not.toHaveBeenCalled();
  });
  it('clears stale reasoning when the goal changes', async () => {
    const view = render(<AIPanel {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Interpret goal with Muse Spark' }));
    await screen.findByText('Keep the drink where it is.');
    view.rerender(<AIPanel {...props} goal="Move everything"/>);
    expect(screen.queryByText('Keep the drink where it is.')).toBeNull();
  });
});
