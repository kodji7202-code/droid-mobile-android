import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAppAt } from '../../test/render-app';

describe('dev-only mission fixture route', () => {
  it('mounts Mission Control over the schema-parsed fixture in development', async () => {
    renderAppAt('/dev/mission-fixture', { connected: false });
    expect(await screen.findByTestId('mission-fixture-route')).toBeInTheDocument();
    expect(screen.getByTestId('missions-view')).toBeInTheDocument();
    expect(await screen.findByTestId('mission-feature-f-pending')).toBeInTheDocument();
  });
});
