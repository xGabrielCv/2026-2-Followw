import { suggestSchedules, type Preferences, type Subject } from '#/lib/schedule-optimizer';

export interface OptimizerJob {
    subjects: Subject[];
    preferences: Preferences;
}

self.addEventListener('message', (event: MessageEvent<OptimizerJob>) => {
    try {
        const { subjects, preferences } = event.data;
        if (
            subjects.length > 100 ||
            subjects.reduce((count, subject) => count + subject.options.length, 0) > 5000
        )
            throw new Error('Opções demais');
        self.postMessage({ result: suggestSchedules(subjects, preferences) }, { transfer: [] });
    } catch {
        self.postMessage({ failed: true }, { transfer: [] });
    }
});
