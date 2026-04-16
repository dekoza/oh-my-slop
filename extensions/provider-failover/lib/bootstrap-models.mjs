import { FAILOVER_API, FAILOVER_PROVIDER_NAME } from './failover-core.mjs';

const FALLBACK_WRAPPER = {
	reasoning: false,
	input: ['text'],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
};

export function buildPersistedWrapperSnapshot(wrapperModel) {
	return {
		reasoning: wrapperModel.reasoning === true,
		input: [...wrapperModel.input],
		cost: { ...wrapperModel.cost },
		contextWindow: wrapperModel.contextWindow,
		maxTokens: wrapperModel.maxTokens,
	};
}

export function buildBootstrapWrapperModel(configuredModel) {
	const wrapper = configuredModel.wrapper ?? FALLBACK_WRAPPER;
	return {
		id: configuredModel.id,
		name: configuredModel.name,
		provider: FAILOVER_PROVIDER_NAME,
		api: FAILOVER_API,
		reasoning: wrapper.reasoning === true,
		input: Array.isArray(wrapper.input) ? [...wrapper.input] : [...FALLBACK_WRAPPER.input],
		cost: wrapper.cost ? { ...wrapper.cost } : { ...FALLBACK_WRAPPER.cost },
		contextWindow: Number.isFinite(wrapper.contextWindow) ? wrapper.contextWindow : FALLBACK_WRAPPER.contextWindow,
		maxTokens: Number.isFinite(wrapper.maxTokens) ? wrapper.maxTokens : FALLBACK_WRAPPER.maxTokens,
	};
}
